import { ParseError, UNRATED, type ParsedResult } from '../types.js'
import { parseJson } from './util.js'

/**
 * Written against the pinned Nikto version (see tools.ts). Accepts one scan object or an
 * array of them; each has { host, port, vulnerabilities: [{ id, method, url, msg }] }.
 * Checked against a real 2.6.1 run (test/fixtures/nikto.json).
 * Nikto itself assigns no severity to a finding, so every result is 'unrated', never 'info'
 * (which would wrongly claim Nikto rated it as low-risk).
 */
export function parseNikto(output: string): ParsedResult[] {
  const doc = parseJson(output, 'nikto')
  const scans = Array.isArray(doc) ? doc : [doc]
  const results: ParsedResult[] = []
  for (const s of scans) {
    if (!s || typeof s !== 'object' || typeof s.host !== 'string' || !Array.isArray(s.vulnerabilities)) {
      throw new ParseError('nikto: JSON does not look like a Nikto report (missing host / vulnerabilities)')
    }
    // Nikto reports a connection failure as a fake finding with id "FAIL". That is a failed scan, not a result.
    const fail = s.vulnerabilities.find((v: any) => v?.id === 'FAIL')
    if (fail) throw new ParseError(`nikto: ${fail.msg ?? 'scan failed'}`)
    const port = s.port !== undefined ? Number(s.port) : undefined
    for (const v of s.vulnerabilities) {
      results.push({
        kind: 'vulnerability', host: s.host, port, // The same Nikto id can fire several times on one URL with a different message, so the message is part of the key.
        value: `nikto-${v.id} ${v.method ?? ''} ${v.url ?? ''}: ${v.msg ?? ''}`.trim(),
        title: String(v.msg ?? v.id), severity: UNRATED,
        data: { id: v.id, method: v.method ?? null, url: v.url ?? null, references: v.references ?? null },
      })
    }
  }
  return results
}
