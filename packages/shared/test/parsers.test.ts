import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ParseError, TOOLS, TOOL_IDS, adaptTarget, dedupeKey, isInScope, isSafeTarget, nucleiArgs, type ScopeEntry } from '../src/index.js'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')

// Fixtures nmap.xml, subfinder.jsonl, gobuster.txt, ftpscan.json, nuclei.jsonl, nikto.json are REAL output
// captured from the lab (Juice Shop 10.10.0.5, vsftpd 10.10.0.6). Only enum4linux.json is still hand-written.
describe('nmap (real output)', () => {
  const r = TOOLS.nmap.parse(fx('nmap.xml'), '10.10.0.5')
  it('reports the live host and only open ports', () => {
    expect(r.filter((x) => x.kind === 'host').map((x) => x.host)).toEqual(['10.10.0.5'])
    expect(r.filter((x) => x.kind === 'port').map((x) => x.port)).toEqual([3000])
  })
  it('keeps hostnames and a service entry for the open port', () => {
    expect((r[0].data as any).hostnames[0]).toContain('juice-shop')
    expect(r.some((x) => x.kind === 'service' && x.port === 3000)).toBe(true)
  })
  it('carries no severity: a host, port or service is an observation, not a finding', () => {
    expect(r.every((x) => x.severity === undefined)).toBe(true)
  })
  it('rejects cut-off XML', () => {
    expect(() => TOOLS.nmap.parse(fx('nmap.xml').slice(0, 300), 'x')).toThrow(ParseError)
  })
})

describe('subfinder (real output)', () => {
  const r = TOOLS.subfinder.parse(fx('subfinder.jsonl'), 'example.com')
  it('parses every line, lowercased, and keeps the source (a string in real output)', () => {
    expect(r).toHaveLength(40)
    expect(r.every((x) => x.host === x.host.toLowerCase() && x.kind === 'subdomain')).toBe(true)
    expect((r[0].data as any).sources).toEqual(['subdomaincenter'])
  })
  it('carries no severity: a subdomain is an observation, not a finding', () => {
    expect(r.every((x) => x.severity === undefined)).toBe(true)
  })
  it('fails on a cut-off line', () => {
    expect(() => TOOLS.subfinder.parse('{"host":"a.example.com"}\n{"host":"b.exa', 'x')).toThrow(ParseError)
  })
  it('a clean run with zero subdomains (empty output, exit 0) succeeds with no results, not a failure', () => {
    expect(TOOLS.subfinder.parse('', 'x', 0)).toEqual([])
  })
  it('empty output is still a failure when the exit code is missing or non-zero', () => {
    expect(() => TOOLS.subfinder.parse('', 'x')).toThrow(ParseError)
    expect(() => TOOLS.subfinder.parse('', 'x', 1)).toThrow(ParseError)
  })
})

describe('gobuster (real output)', () => {
  const r = TOOLS.gobuster.parse(fx('gobuster.txt'), 'http://10.10.0.5:3000')
  it('finds all 11 hits, splitting directories from files', () => {
    expect(r).toHaveLength(11)
    expect(r.find((x) => x.value === '/assets')).toMatchObject({ kind: 'directory', host: '10.10.0.5', port: 3000 })
    expect(r.find((x) => x.value === '/robots.txt')).toMatchObject({ kind: 'url' })
  })
  it('carries no severity: a directory or file is an observation, not a finding', () => {
    expect(r.every((x) => x.severity === undefined)).toBe(true)
  })
  it('fails when there is nothing and no Finished line', () => {
    expect(() => TOOLS.gobuster.parse('Starting gobuster\n', 'http://x')).toThrow(ParseError)
  })
  it('accepts a finished run with zero hits', () => {
    expect(TOOLS.gobuster.parse('Finished\n', 'http://x')).toEqual([])
  })
  it('retries ignoring the length of a single-page app catch-all page', () => {
    const msg = 'the server returns a status code that matches the provided options for non existing urls. http://x/abc => 200 (Length: 9984). Please exclude'
    expect(TOOLS.gobuster.retry!({ stderr: msg, exitCode: 1 })).toEqual(['--exclude-length', '9984'])
    expect(TOOLS.gobuster.retry!({ stderr: 'something else', exitCode: 1 })).toBeNull()
  })
})

describe('enum4linux-ng', () => {
  const r = TOOLS['enum4linux-ng'].parse(fx('enum4linux.json'), '10.10.0.7')
  it('emits a host and one result per share', () => {
    expect(r.filter((x) => x.kind === 'share').map((x) => x.value)).toEqual(['public', 'IPC$'])
    expect((r[0].data as any).users[0].username).toBe('alice')
  })
  it('carries no severity: a host or share is an observation, not a finding', () => {
    expect(r.every((x) => x.severity === undefined)).toBe(true)
  })
})

describe('ftp-scan', () => {
  it('real run: banner and port, no anonymous login on this server', () => {
    const r = TOOLS['ftp-scan'].parse(fx('ftpscan.json'), '10.10.0.6')
    expect(r.map((x) => x.kind)).toEqual(['port', 'service'])
    expect(r[1].title).toContain('vsFTPd 3.0.2')
    expect(r.every((x) => x.severity === undefined)).toBe(true) // a port/banner is an observation, not a finding
  })
  it('flags anonymous login and exploit matches without calling them confirmed (synthetic input)', () => {
    const r = TOOLS['ftp-scan'].parse('{"target":"10.0.0.1","port":21,"banner":"220 (vsFTPd 2.3.4)","anonymous_login":true,"listing":["pub"],"exploits":[{"id":"EDB-17491","title":"x"}]}', 'x')
    expect(r.find((x) => x.value === 'ftp-anonymous-login')!.severity).toBe('medium')
    expect(r.find((x) => x.value === 'EDB-17491')!.severity).toBe('info')
  })
})

describe('nuclei (real output)', () => {
  const r = TOOLS.nuclei.parse(fx('nuclei.jsonl'), 'http://10.10.0.5:3000')
  it('keeps every match: one template can match once per matcher', () => {
    expect(r).toHaveLength(11)
    expect(new Set(r.map(dedupeKey)).size).toBe(11)
    expect(r.filter((x) => (x.data as any).template_id === 'http-missing-security-headers')).toHaveLength(8)
  })
  it('maps host, port and severity', () => {
    expect(r[0]).toMatchObject({ kind: 'vulnerability', host: '10.10.0.5', port: 3000, severity: 'info' })
  })
  it('excludes disruptive tags unless allowed', () => {
    expect(nucleiArgs('http://x', {}).join(' ')).toContain('-etags dos,fuzz,intrusive')
    expect(nucleiArgs('http://x', { module: 'full', allowDisruptive: true }).join(' ')).not.toContain('-etags')
  })
  it('rejects an unknown module', () => {
    expect(() => nucleiArgs('http://x', { module: 'evil' })).toThrow()
  })
  it('a clean run with zero matches (empty output, exit 0) succeeds with no results, not a failure', () => {
    // This is the real shape of a cves-module run against a target with no matching CVE templates.
    expect(TOOLS.nuclei.parse('', 'x', 0)).toEqual([])
  })
  it('empty output is still a failure when the exit code is missing or non-zero', () => {
    expect(() => TOOLS.nuclei.parse('', 'x')).toThrow(ParseError)
    expect(() => TOOLS.nuclei.parse('', 'x', 1)).toThrow(ParseError)
  })
})

describe('nikto 2.6.1 (real output)', () => {
  const r = TOOLS.nikto.parse(fx('nikto.json'), 'http://10.10.0.5:3000')
  it('keeps all 15 findings, including repeated ids with different messages', () => {
    expect(r).toHaveLength(15)
    expect(new Set(r.map(dedupeKey)).size).toBe(15)
    expect(r[0]).toMatchObject({ host: '10.10.0.5', port: 3000 })
  })
  it('is "unrated", never "info": Nikto itself assigns no severity to a finding', () => {
    expect(r.every((x) => x.severity === 'unrated')).toBe(true)
  })
  it('fails on a wrong-shaped document', () => {
    expect(() => TOOLS.nikto.parse('{"foo":1}', 'x')).toThrow(ParseError)
  })
  it('treats Nikto connection failure (real output, id FAIL) as a failed scan, not a finding', () => {
    const failed = '[{"host":"10.10.0.5","port":3000,"vulnerabilities":[{"id":"FAIL","method":"GET","msg":"Unable to connect to 10.10.0.5:3000.","url":"/"}]}]'
    expect(() => TOOLS.nikto.parse(failed, 'x')).toThrow(/Unable to connect/)
  })
})

describe('xss-probe (real output, native headless-browser check against the lab)', () => {
  it('includes severity, payload, affected URL and evidence for each finding', () => {
    const r = TOOLS['xss-probe'].parse(fx('xss-probe-findings.json'), 'http://127.0.0.1:3001/#/search?q=test')
    expect(r).toHaveLength(2)
    for (const x of r) {
      expect(x.kind).toBe('vulnerability')
      expect(x.severity).toBe('high')
      expect(x.host).toBe('127.0.0.1')
      expect(x.port).toBe(3001)
      expect(typeof (x.data as any).payload).toBe('string')
      expect(typeof (x.data as any).affected_url).toBe('string')
      expect((x.data as any).evidence).toMatchObject({ type: 'alert' })
    }
    expect(r[0].title).not.toMatch(/confirmed/i) // house style: a scanner result is never called "confirmed"
  })
  it('two runs with different per-test markers produce the SAME dedupe keys (no duplicate rows on re-run)', () => {
    const a = TOOLS['xss-probe'].parse(fx('xss-probe-findings.json'), 'http://127.0.0.1:3001/#/search?q=test')
    const raw = fx('xss-probe-findings.json')
    const seen = new Map<string, string>()
    let n = 0
    // Each distinct original marker maps to ONE new value, so a `payload`/`evidence.message` pair
    // that agreed before still agrees after — a naive offset-based replace would break that pairing.
    const rerun = raw.replace(/naqb-xss-[0-9a-f]+/g, (m) => seen.get(m) ?? (seen.set(m, `naqb-xss-rerun${n++}`), seen.get(m)!))
    const b = TOOLS['xss-probe'].parse(rerun, 'http://127.0.0.1:3001/#/search?q=test')
    expect(a.map(dedupeKey)).toEqual(b.map(dedupeKey))
  })
  it('a target where nothing fired is zero findings, not an error', () => {
    expect(TOOLS['xss-probe'].parse(fx('xss-probe-clean.json'), 'http://127.0.0.1:3001/#/track-result?id=test')).toEqual([])
  })
  it('fails on a wrong-shaped document', () => {
    expect(() => TOOLS['xss-probe'].parse('{"foo":1}', 'x')).toThrow(ParseError)
  })
  it('if every test was inconclusive, that is a failed job, never a silent empty result', () => {
    const allInconclusive = JSON.stringify({ target: 'x', tested: 2, findings: [], inconclusive: [{ reason: 'timeout' }, { reason: 'timeout' }] })
    expect(() => TOOLS['xss-probe'].parse(allInconclusive, 'x')).toThrow(ParseError)
  })
})

describe('every parser handles bad output', () => {
  for (const id of TOOL_IDS) {
    it(`${id}: empty and garbage give ParseError`, () => {
      expect(() => TOOLS[id].parse('', 'http://10.0.0.1')).toThrow(ParseError)
      expect(() => TOOLS[id].parse('<<<garbage', 'http://10.0.0.1')).toThrow(ParseError)
    })
  }
})

describe('dedupe', () => {
  it('same finding gives the same key on a re-run', () => {
    const a = TOOLS.subfinder.parse(fx('subfinder.jsonl'), 'x')
    const b = TOOLS.subfinder.parse(fx('subfinder.jsonl'), 'x')
    expect(a.map(dedupeKey)).toEqual(b.map(dedupeKey))
  })
})

describe('scope', () => {
  const s: ScopeEntry[] = [
    { kind: 'cidr', value: '10.10.0.0/24' }, { kind: 'domain', value: 'example.com' },
    { kind: 'ip', value: '192.168.1.5' }, { kind: 'url', value: 'http://shop.test:8080' },
  ]
  it('allows covered targets', () => {
    for (const t of ['10.10.0.5', 'http://10.10.0.5:3000/x', 'api.example.com', 'https://example.com/a', '192.168.1.5', 'http://shop.test:8080/z', '10.10.0.128/25'])
      expect(isInScope(t, s), t).toBe(true)
  })
  it('rejects everything else', () => {
    for (const t of ['10.10.1.5', 'evilexample.com', 'example.com.evil.org', '8.8.8.8', '10.10.0.0/16', 'http://other.test'])
      expect(isInScope(t, s), t).toBe(false)
  })
  it('rejects injection and flags', () => {
    for (const t of ['-oN /tmp/x', '10.10.0.5; rm -rf /', '$(id).example.com', '10.10.0.5 -p-', '', '--script=x'])
      expect(isInScope(t, s), t).toBe(false)
    expect(isSafeTarget('-v')).toBe(false)
  })
  it('allows "#" for single-page-app hash routes (e.g. "http://host/#/search?q=...")', () => {
    expect(isSafeTarget('http://10.10.0.5:3000/#/search?q=test')).toBe(true)
    expect(isInScope('http://10.10.0.5:3000/#/search?q=test', s)).toBe(true)
  })
  it('fails closed on empty scope', () => expect(isInScope('10.10.0.5', [])).toBe(false))
})

describe('adaptTarget: any input, converted per tool', () => {
  const a = (tool: keyof typeof TOOLS, input: string) => adaptTarget(TOOLS[tool], input)
  it('url tools get a URL from an IP, host:port or domain', () => {
    expect(a('nikto', '10.10.0.5')).toMatchObject({ ok: true, target: 'http://10.10.0.5' })
    expect(a('nuclei', '10.10.0.5:3000')).toMatchObject({ ok: true, target: 'http://10.10.0.5:3000' })
    expect(a('gobuster', 'example.com:443')).toMatchObject({ ok: true, target: 'https://example.com:443' })
    expect(a('nikto', 'https://example.com/app')).toMatchObject({ ok: true, target: 'https://example.com/app' })
  })
  it('host tools get a bare host from a URL', () => {
    expect(a('nmap', 'http://10.10.0.5:3000/x')).toMatchObject({ ok: true, target: '10.10.0.5' })
    expect(a('ftp-scan', 'ftp.example.com')).toMatchObject({ ok: true, target: 'ftp.example.com' })
  })
  it('domain tools get a domain, and reject an IP', () => {
    expect(a('subfinder', 'https://www.example.com/a')).toMatchObject({ ok: true, target: 'www.example.com' })
    expect(a('subfinder', '10.10.0.5').ok).toBe(false)
  })
  it('only nmap takes a range', () => {
    expect(a('nmap', '10.10.0.0/24')).toMatchObject({ ok: true, target: '10.10.0.0/24' })
    expect(a('nikto', '10.10.0.0/24').ok).toBe(false)
  })
  it('rejects junk and flags', () => {
    for (const t of ['-oN x', 'a b', 'rm -rf /', 'ftp://x', '', '$(id)']) expect(a('nmap', t).ok, t).toBe(false)
  })
})
