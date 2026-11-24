import { ParseError, type ParsedResult } from '../types.js'
import { parseJsonLines, toSeverity } from './util.js'

/** `exitCode` lets a clean run with zero matches (empty stdout, exit 0) succeed with no results. */
export function parseNuclei(output: string, exitCode?: number): ParsedResult[] {
  const rows = parseJsonLines(output, 'nuclei', exitCode)
  return rows.map((r, i) => {
    const id = r['template-id'] ?? r.templateID
    const matched = r['matched-at'] ?? r.matched ?? r.host
    if (typeof id !== 'string' || typeof matched !== 'string') throw new ParseError(`nuclei: line ${i + 1} lacks template-id or matched-at`)
    let host = String(r.host ?? matched)
    let port: number | undefined
    try {
      const u = new URL(matched.includes('://') ? matched : 'http://' + matched)
      host = u.hostname
      if (u.port) port = Number(u.port)
    } catch { /* keep raw host */ }
    const info = r.info ?? {}
    return {
      kind: 'vulnerability' as const, host, port,
      // One template can match several times on the same URL (one per matcher, e.g. each missing header): keep them apart.
      value: `${id}${r['matcher-name'] ? ` [${r['matcher-name']}]` : ''} @ ${matched}`,
      title: String(info.name ?? id) + (r['matcher-name'] ? `: ${r['matcher-name']}` : ''), severity: toSeverity(info.severity),
      data: { template_id: id, matcher: r['matcher-name'] ?? null, matched_at: matched, type: r.type ?? null, tags: info.tags ?? [], reference: info.reference ?? [], description: info.description ?? null, extracted: r['extracted-results'] ?? null },
    }
  })
}
