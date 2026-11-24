import type { ToolDef } from './tools.js'

export type AdaptResult = { ok: true; target: string; note?: string } | { ok: false; error: string }

type Parsed =
  | { type: 'cidr'; host: string }
  | { type: 'ip'; host: string; port?: string }
  | { type: 'domain'; host: string; port?: string }
  | { type: 'url'; host: string; port?: string; scheme: string; path: string }

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

function parse(input: string): Parsed | null {
  const t = input.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(t)) return { type: 'cidr', host: t }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    try {
      const u = new URL(t)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return { type: 'url', host: u.hostname, port: u.port || undefined, scheme: u.protocol.slice(0, -1), path: u.pathname === '/' ? '' : u.pathname }
    } catch { return null }
  }
  const m = /^([^/:\s]+)(?::(\d{1,5}))?(\/.*)?$/.exec(t)
  if (!m || !HOST.test(m[1])) return null
  return IPV4.test(m[1]) ? { type: 'ip', host: m[1], port: m[2] } : { type: 'domain', host: m[1], port: m[2] }
}

/**
 * The tester types anything (IP, range, domain, URL, host:port). This turns it into the form the tool needs:
 *  - url tools (Gobuster, Nuclei, Nikto): http://host[:port][/path]   (https for 443/8443 or when given)
 *  - host tools (Nmap, Enum4Linux-NG, FTP-Scan): bare host / IP (Nmap also accepts a range)
 *  - domain tools (Subfinder): bare domain; an IP is rejected because it makes no sense there
 */
export function adaptTarget(tool: Pick<ToolDef, 'label' | 'targetType' | 'acceptsCidr'>, input: string): AdaptResult {
  const p = parse(input)
  if (!p) return { ok: false, error: `"${input}" is not a valid IP, range, domain or URL.` }

  if (p.type === 'cidr') {
    if (tool.acceptsCidr) return { ok: true, target: p.host }
    return { ok: false, error: `${tool.label} cannot scan an IP range. Enter a single host, or use Nmap for ranges.` }
  }

  switch (tool.targetType) {
    case 'host':
      return { ok: true, target: p.host }
    case 'domain':
      if (p.type === 'ip') return { ok: false, error: `${tool.label} needs a domain name (e.g. example.com), not an IP address.` }
      return { ok: true, target: p.host }
    case 'url': {
      if (p.type === 'url') return { ok: true, target: `${p.scheme}://${p.host}${p.port ? ':' + p.port : ''}${p.path}` }
      const https = p.port === '443' || p.port === '8443'
      const target = `${https ? 'https' : 'http'}://${p.host}${p.port ? ':' + p.port : ''}`
      return { ok: true, target, note: `Will scan ${target}` }
    }
  }
}
