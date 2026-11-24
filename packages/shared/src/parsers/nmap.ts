import { XMLParser } from 'fast-xml-parser'
import { ParseError, type ParsedResult } from '../types.js'
import { requireText } from './util.js'

const ALWAYS_ARRAY = new Set(['host', 'port', 'address', 'hostname', 'osmatch'])

export function parseNmap(output: string): ParsedResult[] {
  requireText(output, 'nmap')
  // A finished nmap XML file ends with </nmaprun>; a cut-off one does not.
  if (!/<\/nmaprun>\s*$/.test(output)) throw new ParseError('nmap: XML is incomplete (no closing </nmaprun>)')
  let doc: any
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: (n) => ALWAYS_ARRAY.has(n) }).parse(output)
  } catch {
    throw new ParseError('nmap: XML is malformed')
  }
  if (!doc?.nmaprun) throw new ParseError('nmap: not an nmap XML file')

  const results: ParsedResult[] = []
  for (const h of doc.nmaprun.host ?? []) {
    if (h.status?.['@_state'] !== 'up') continue
    const addr = (h.address ?? []).find((a: any) => a['@_addrtype'] === 'ipv4' || a['@_addrtype'] === 'ipv6')
    if (!addr) continue
    const ip = String(addr['@_addr'])
    const hostnames = (h.hostnames?.hostname ?? []).map((n: any) => String(n['@_name']))
    const os = h.os?.osmatch?.[0]
    results.push({
      kind: 'host',
      host: ip,
      value: ip,
      title: hostnames.length ? `Host up: ${ip} (${hostnames.join(', ')})` : `Host up: ${ip}`,
      // A live host is an observation, not a finding: no severity.
      data: { hostnames, os: os ? { name: os['@_name'], accuracy: Number(os['@_accuracy']) } : null },
    })
    for (const p of h.ports?.port ?? []) {
      if (p.state?.['@_state'] !== 'open') continue
      const port = Number(p['@_portid'])
      const proto = String(p['@_protocol'])
      const svc = p.service ?? {}
      const version = [svc['@_product'], svc['@_version'], svc['@_extrainfo']].filter(Boolean).join(' ')
      results.push({
        kind: 'port', host: ip, port, value: `${port}/${proto}`,
        title: `Open port ${port}/${proto}`,
        data: { protocol: proto, service: svc['@_name'] ?? null },
      })
      if (svc['@_name']) {
        results.push({
          kind: 'service', host: ip, port, value: `${port}/${proto} ${svc['@_name']}`,
          title: `${svc['@_name']}${version ? ' — ' + version : ''} on ${port}/${proto}`,
          data: { name: svc['@_name'], product: svc['@_product'] ?? null, version: svc['@_version'] ?? null, extrainfo: svc['@_extrainfo'] ?? null },
        })
      }
    }
  }
  return results
}
