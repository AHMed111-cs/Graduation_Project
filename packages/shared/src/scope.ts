import type { ScopeEntry } from './types.js'

/**
 * Only these characters may appear in a target. Blocks flags ("-oN"), spaces, shell metacharacters.
 * '#' is the one addition beyond the obvious URL characters: it is RFC 3986's fragment delimiter, used
 * by single-page apps for hash-based routing (e.g. "http://host/#/search?q=..."), and poses no shell
 * risk here since targets are passed as argv elements, never through a shell.
 */
const SAFE_TARGET = /^[A-Za-z0-9][A-Za-z0-9.:/_\-?=&%@#\[\]]*$/

export function isSafeTarget(target: string): boolean {
  return target.length > 0 && target.length <= 2048 && SAFE_TARGET.test(target)
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((p) => p > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function cidrBounds(cidr: string): [number, number] | null {
  const [ip, bitsStr] = cidr.split('/')
  const base = ipv4ToInt(ip)
  const bits = Number(bitsStr)
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null
  const size = 2 ** (32 - bits)
  const start = Math.floor(base / size) * size
  return [start, start + size - 1]
}

/** Host part of a target (strips scheme, path, port). Returns null for things we can't read. */
export function hostOf(target: string): string | null {
  let t = target.trim().toLowerCase()
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(t)) {
    try {
      t = new URL(t).hostname
    } catch {
      return null
    }
  } else {
    t = t.split('/')[0] // keep CIDR handling separate (see isInScope)
    t = t.replace(/:\d+$/, '')
  }
  return t.replace(/^\[|\]$/g, '') || null
}

function ruleCoversHost(rule: ScopeEntry, host: string): boolean {
  const value = rule.value.trim().toLowerCase()
  switch (rule.kind) {
    case 'ip':
      return host === value
    case 'cidr': {
      const b = cidrBounds(value)
      const n = ipv4ToInt(host)
      return !!b && n !== null && n >= b[0] && n <= b[1]
    }
    case 'domain':
      return host === value || host.endsWith('.' + value)
    case 'url': {
      const h = hostOf(value)
      return h !== null && h === host
    }
  }
}

/**
 * Is this target inside the project's scope? Fails closed:
 * anything unparseable, unsafe or uncovered returns false.
 * A CIDR target is in scope only if the whole range sits inside one scope CIDR.
 */
export function isInScope(target: string, scope: ScopeEntry[]): boolean {
  if (!isSafeTarget(target) || scope.length === 0) return false
  if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(target)) {
    const t = cidrBounds(target)
    if (!t) return false
    return scope.some((r) => {
      if (r.kind !== 'cidr') return false
      const b = cidrBounds(r.value.trim())
      return !!b && t[0] >= b[0] && t[1] <= b[1]
    })
  }
  const host = hostOf(target)
  if (!host) return false
  return scope.some((r) => ruleCoversHost(r, host))
}
