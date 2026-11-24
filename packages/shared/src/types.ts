/** The one common result format every parser produces. */
export const RESULT_KINDS = ['host', 'port', 'service', 'subdomain', 'url', 'directory', 'share', 'vulnerability'] as const
export type ResultKind = (typeof RESULT_KINDS)[number]

/** Real severity values a tool can report. 'unknown' is a value nuclei itself uses for unrated templates. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'unknown'] as const
export type Severity = (typeof SEVERITIES)[number]
/** Set on a vulnerability result when the tool has no severity concept at all (e.g. Nikto), as opposed
 *  to 'unknown', which means the tool reported a severity string we don't recognise. */
export const UNRATED = 'unrated' as const
export type SeverityOrUnrated = Severity | typeof UNRATED

export interface ParsedResult {
  kind: ResultKind
  /** Host / domain / IP the result belongs to. */
  host: string
  port?: number
  /** The thing found: "80/tcp", "admin.example.com", "/backup", template id... */
  value: string
  /** Short human text. Always rendered as plain text, never HTML. */
  title: string
  /**
   * Only a 'vulnerability' result carries a severity — it's the only kind that means something went
   * wrong. A host, port, subdomain, URL, directory or share is an observation, not a finding, so it
   * must be left undefined: no severity, and not counted in any severity breakdown.
   */
  severity?: SeverityOrUnrated
  /** Tool-specific extras. */
  data: Record<string, unknown>
}

/** Thrown when tool output is empty, cut off or malformed. The worker turns it into a failed job. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

export type ScopeKind = 'ip' | 'cidr' | 'domain' | 'url'
export interface ScopeEntry {
  kind: ScopeKind
  value: string
}

export const TOOL_IDS = ['nmap', 'subfinder', 'gobuster', 'enum4linux-ng', 'ftp-scan', 'nuclei', 'nikto', 'xss-probe'] as const
export type ToolId = (typeof TOOL_IDS)[number]

/** Stable key so re-running a scan updates a row instead of repeating it. */
export function dedupeKey(r: Pick<ParsedResult, 'kind' | 'host' | 'port' | 'value'>): string {
  return [r.kind, r.host.toLowerCase(), r.port ?? '', r.value].join('|')
}
