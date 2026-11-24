import { ParseError, SEVERITIES, type Severity } from '../types.js'

export function requireText(output: string, tool: string): string {
  if (!output || !output.trim()) throw new ParseError(`${tool}: output is empty`)
  return output
}

/**
 * JSON-lines tools (Nuclei, Subfinder) print one line per match and nothing at all when there are
 * zero matches — that is a normal, successful "no results" run, not broken output. So empty output
 * is only accepted when the process is KNOWN to have exited cleanly (exitCode === 0); anything else
 * (a non-zero exit, or exitCode simply not given) is treated as a real failure, same as before.
 */
export function parseJsonLines(output: string, tool: string, exitCode?: number): Record<string, any>[] {
  if (!output || !output.trim()) {
    if (exitCode === 0) return []
    throw new ParseError(`${tool}: output is empty`)
  }
  const rows: Record<string, any>[] = []
  const lines = output.split(/\r?\n/).filter((l) => l.trim())
  lines.forEach((line, i) => {
    try {
      const v = JSON.parse(line)
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
      rows.push(v)
    } catch {
      throw new ParseError(`${tool}: line ${i + 1} is not valid JSON (output cut off or malformed)`)
    }
  })
  return rows
}

export function parseJson(output: string, tool: string): any {
  requireText(output, tool)
  try {
    return JSON.parse(output)
  } catch {
    throw new ParseError(`${tool}: output is not valid JSON (cut off or malformed)`)
  }
}

export function toSeverity(s: unknown): Severity {
  const v = String(s ?? '').toLowerCase()
  return (SEVERITIES as readonly string[]).includes(v) ? (v as Severity) : 'unknown'
}
