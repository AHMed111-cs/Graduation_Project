import { ParseError, type ParsedResult } from '../types.js'
import { requireText } from './util.js'

const DIR_LINE = /^(\S+)\s+\(Status:\s*(\d+)\)(?:\s+\[Size:\s*(\d+)\])?(?:\s+\[-->\s*(\S+)\])?\s*$/
const VHOST_LINE = /^Found:\s+(\S+)\s+Status:\s*(\d+)(?:\s+\[Size:\s*(\d+)\])?/

/** `baseUrl` is the scanned target, so results can be tied to a host. */
export function parseGobuster(output: string, baseUrl: string): ParsedResult[] {
  requireText(output, 'gobuster')
  let base: URL
  try { base = new URL(baseUrl) } catch { throw new ParseError('gobuster: target is not a URL') }
  const results: ParsedResult[] = []
  let finished = false
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()
    if (!line) continue
    if (/^Finished\b/.test(line)) { finished = true; continue }
    const v = VHOST_LINE.exec(line)
    if (v) {
      results.push({ kind: 'subdomain', host: v[1].toLowerCase(), value: v[1].toLowerCase(), title: `Virtual host: ${v[1]} (HTTP ${v[2]})`, data: { status: Number(v[2]), size: v[3] ? Number(v[3]) : null } })
      continue
    }
    const m = DIR_LINE.exec(line)
    if (!m) continue
    const path = m[1].startsWith('/') ? m[1] : '/' + m[1]
    const redirect = m[4] ?? null
    const isDir = path.endsWith('/') || (redirect !== null && redirect.endsWith('/'))
    results.push({
      kind: isDir ? 'directory' : 'url', host: base.hostname, port: base.port ? Number(base.port) : undefined,
      value: path, title: `${isDir ? 'Directory' : 'File'} ${path} (HTTP ${m[2]})`,
      data: { status: Number(m[2]), size: m[3] ? Number(m[3]) : null, redirect, url: new URL(path, base).href },
    })
  }
  if (results.length === 0 && !finished) throw new ParseError('gobuster: no results and no "Finished" line (output cut off?)')
  return results
}
