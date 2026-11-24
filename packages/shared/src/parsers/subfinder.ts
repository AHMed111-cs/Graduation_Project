import { ParseError, type ParsedResult } from '../types.js'
import { parseJsonLines } from './util.js'

/** `exitCode` lets a clean run with zero subdomains (empty stdout, exit 0) succeed with no results. */
export function parseSubfinder(output: string, exitCode?: number): ParsedResult[] {
  const rows = parseJsonLines(output, 'subfinder', exitCode)
  return rows.map((r, i) => {
    if (typeof r.host !== 'string' || !r.host) throw new ParseError(`subfinder: line ${i + 1} has no "host"`)
    const host = r.host.toLowerCase()
    return {
      // A subdomain is an observation, not a finding: no severity.
      kind: 'subdomain' as const, host, value: host, title: `Subdomain: ${host}`,
      data: { input: r.input ?? null, sources: Array.isArray(r.source) ? r.source : typeof r.source === 'string' ? [r.source] : [] },
    }
  })
}
