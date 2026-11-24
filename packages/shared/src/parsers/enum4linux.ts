import { ParseError, type ParsedResult } from '../types.js'
import { parseJson } from './util.js'

/** Users, groups and policy are kept in the host result's data (the common format has no "account" kind). */
export function parseEnum4linux(output: string, targetHost: string): ParsedResult[] {
  const doc = parseJson(output, 'enum4linux-ng')
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new ParseError('enum4linux-ng: unexpected JSON shape')
  const host = String(doc.target?.host ?? targetHost)
  const users = Object.values<any>(doc.users ?? {}).map((u) => ({ username: u.username, name: u.name, description: u.description }))
  const groups = Object.entries<any>(doc.groups ?? {}).map(([rid, g]) => ({ rid, groupname: g.groupname }))
  const results: ParsedResult[] = [{
    // A host or a share is an observation, not a finding: no severity.
    kind: 'host', host, value: host, title: `SMB host: ${host}`,
    data: { os_info: doc.os_info ?? null, users, groups, password_policy: doc.policy ?? doc.password_policy ?? null },
  }]
  for (const [name, s] of Object.entries<any>(doc.shares ?? {})) {
    const access = s.access ?? {}
    results.push({
      kind: 'share', host, port: 445, value: name, title: `SMB share ${name}${s.comment ? ' — ' + s.comment : ''}`,
      data: { type: s.type ?? null, comment: s.comment ?? null, mapping: access.mapping ?? null, listing: access.listing ?? null, writing: access.writing ?? null },
    })
  }
  return results
}
