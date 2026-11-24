import { ParseError, type ParsedResult } from '../types.js'
import { parseJson } from './util.js'

/**
 * FTP-Scan is vendored and patched in the repo, so its JSON schema is defined by us:
 * { target, port, banner, anonymous_login, listing: string[], exploits: [{ id, title }] }
 * Exploit-database matches are possible issues only, so they are 'info', never 'confirmed'.
 */
export function parseFtpScan(output: string): ParsedResult[] {
  const doc = parseJson(output, 'ftp-scan')
  const docs = Array.isArray(doc) ? doc : [doc]
  const results: ParsedResult[] = []
  for (const d of docs) {
    if (!d || typeof d.target !== 'string') throw new ParseError('ftp-scan: entry has no "target"')
    const host = d.target
    const port = Number(d.port ?? 21)
    // A port or a banner is an observation, not a finding: no severity.
    results.push({ kind: 'port', host, port, value: `${port}/tcp`, title: `Open port ${port}/tcp (FTP)`, data: { protocol: 'tcp', service: 'ftp' } })
    results.push({ kind: 'service', host, port, value: `${port}/tcp ftp`, title: `FTP banner: ${d.banner ?? '(none)'}`, data: { banner: d.banner ?? null } })
    if (d.anonymous_login === true) {
      results.push({ kind: 'vulnerability', host, port, value: 'ftp-anonymous-login', title: 'FTP anonymous login allowed', severity: 'medium', data: { listing: Array.isArray(d.listing) ? d.listing : [] } })
    }
    for (const e of d.exploits ?? []) {
      results.push({ kind: 'vulnerability', host, port, value: String(e.id), title: `Exploit DB match: ${e.title ?? e.id}`, severity: 'info', data: { match: 'banner-version', ...e } })
    }
  }
  return results
}
