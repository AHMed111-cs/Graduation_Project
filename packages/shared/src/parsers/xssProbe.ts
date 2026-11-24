import { ParseError, type ParsedResult } from '../types.js'
import { parseJson } from './util.js'

/**
 * Consumes the native XSS prober's single JSON object: { target, tested, findings, inconclusive }
 * (see native-tools/xss-probe/detect.mjs, run with --quiet). Each finding is a JS
 * alert/confirm/prompt that actually fired in a real browser, carrying a per-test marker — this
 * catches DOM-based XSS (payload only ever appears in the DOM after client-side JS inserts it, never
 * in any HTTP response body) that an HTTP-response-scanning active scanner (e.g. ZAP's classic rules)
 * cannot see at all.
 *
 * `inconclusive` entries are tests whose result could not be determined — never silently treated as
 * "no vulnerability found". If EVERY test was inconclusive, that is equivalent in spirit to
 * empty/malformed tool output: the house rule is a clear failed job with an error, never a silent
 * empty result.
 */
export function parseXssProbe(output: string, target: string): ParsedResult[] {
  const doc = parseJson(output, 'xss-probe')
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.findings) || typeof doc.tested !== 'number') {
    throw new ParseError('xss-probe: unexpected JSON shape (missing tested/findings)')
  }
  const inconclusive = Array.isArray(doc.inconclusive) ? doc.inconclusive : []
  if (doc.tested > 0 && inconclusive.length === doc.tested && doc.findings.length === 0) {
    throw new ParseError(`xss-probe: all ${doc.tested} test(s) were inconclusive (browser crashed or hung on every attempt) — nothing could be verified`)
  }

  let host = target
  let port: number | undefined
  try {
    const u = new URL(target)
    host = u.hostname
    if (u.port) port = Number(u.port)
  } catch { /* keep raw target as host */ }

  return doc.findings.map((f: any) => {
    if (typeof f.name !== 'string' || typeof f.location !== 'string' || typeof f.param !== 'string' ||
        typeof f.payload !== 'string' || typeof f.url !== 'string' || typeof f.evidence?.message !== 'string') {
      throw new ParseError('xss-probe: a finding is missing name/location/param/payload/url/evidence.message')
    }
    // Each finding carries its OWN per-test marker (evidence.message is exactly that marker for our
    // synthetic payloads); normalising it out of `value` keeps the dedupe key stable across re-runs
    // instead of growing a "new" row every time just because the random marker changed.
    const payloadTemplate = String(f.payload).split(f.evidence.message).join('<marker>')
    return {
      kind: 'vulnerability' as const, host, port,
      value: `${f.location}:${f.param} ${payloadTemplate}`,
      title: `JavaScript alert executed via "${f.param}" (${f.name}, ${f.location.replace('-guess', ', guessed')} parameter)`,
      severity: 'high' as const,
      // Explicit top-level fields (not just nested) so they read clearly in the results detail view:
      // the affected URL, the exact payload used, and the evidence that it actually executed.
      data: {
        payload: f.payload, affected_url: f.url, evidence: f.evidence,
        location: f.location, param: f.param, payload_template: payloadTemplate,
      },
    }
  })
}
