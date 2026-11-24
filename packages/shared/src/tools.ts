import type { ParsedResult, ToolId } from './types.js'
import { parseNmap } from './parsers/nmap.js'
import { parseSubfinder } from './parsers/subfinder.js'
import { parseGobuster } from './parsers/gobuster.js'
import { parseEnum4linux } from './parsers/enum4linux.js'
import { parseFtpScan } from './parsers/ftpscan.js'
import { parseNuclei } from './parsers/nuclei.js'
import { parseNikto } from './parsers/nikto.js'
import { parseXssProbe } from './parsers/xssProbe.js'

export const NUCLEI_MODULES = ['basic', 'cves', 'exposures', 'technologies', 'full'] as const
export type NucleiModule = (typeof NUCLEI_MODULES)[number]
/** Never run unless the Team Lead allows it for the target. */
export const NUCLEI_DISRUPTIVE_TAGS = ['dos', 'fuzz', 'intrusive']

export interface ToolOptions {
  module?: string
  allowDisruptive?: boolean
  /** Path INSIDE the container; the worker mounts the wordlist directory from its config. */
  wordlist?: string
}

export interface ToolDef {
  id: ToolId
  label: string
  /**
   * 'container' (default): the worker runs `image` as a throwaway Docker container, exactly like
   * every other tool. 'host': the worker instead spawns a plain process on its own machine — no
   * Docker at all. Only xss-probe uses this: its browser (Chromium's crashpad crash-handler
   * specifically) cannot start under a --read-only container root, confirmed by instrumented testing
   * (see native-tools/xss-probe/README.md). A host-mode tool loses Docker's network/resource
   * confinement; it relies on the SAME scope check every tool gets, run before either execution path.
   */
  execute?: 'container' | 'host'
  /** Pinned. Verify each tag exists with `docker pull` before first use. Required when execute is 'container'. */
  image?: string
  /** Required when execute is 'host'. Resolved by the worker against the repo root (not here: this
   *  package is also bundled into the browser, where a filesystem path makes no sense). */
  hostScript?: string
  targetType: 'host' | 'url' | 'domain'
  /** Only Nmap can take an IP range. */
  acceptsCidr?: boolean
  /** 'lab' = the isolated lab network. 'internet' = passive tools that must query public sources (Subfinder). */
  network?: 'lab' | 'internet'
  timeoutSec: number
  /** Container memory cap. Defaults to the worker's config value; Nuclei needs more to load its templates. */
  memory?: string
  /** Replace the image's entrypoint (used only with FIXED scripts; the target is still a separate argument). */
  entrypoint?: string[]
  /** Read-only volumes/dirs the tool needs, e.g. nuclei templates. */
  volumes?: { source: string; target: string }[]
  /** If the first run failed, return extra args for ONE automatic re-run (or null). */
  retry?(run: { stderr: string; exitCode: number }): string[] | null
  /** Argument LIST. Never joined into a shell string. For a 'host' tool, these follow `hostScript`. */
  args(target: string, o: ToolOptions): string[]
  /**
   * Converts the tool's stdout into the common result format (throws ParseError on bad output).
   * `exitCode` lets a parser tell a genuinely empty-but-successful run (e.g. "0 matches") apart from
   * broken output; most parsers ignore it because their tool never prints nothing on success.
   */
  parse(output: string, target: string, exitCode?: number): ParsedResult[]
}

const MODULE_TAGS: Record<NucleiModule, string[] | null> = {
  basic: ['tech', 'misconfig'], cves: ['cve'], exposures: ['exposure', 'token'], technologies: ['tech'], full: null,
}

export function nucleiArgs(target: string, o: ToolOptions): string[] {
  const mod = (o.module ?? 'basic') as NucleiModule
  if (!(mod in MODULE_TAGS)) throw new Error(`Unknown nuclei module "${mod}"`)
  const args = ['-u', target, '-jsonl', '-silent', '-nc', '-t', '/templates', '-duc', '-ni', '-rl', '50']
  const tags = MODULE_TAGS[mod]
  if (tags) args.push('-tags', tags.join(','))
  if (!o.allowDisruptive) args.push('-etags', NUCLEI_DISRUPTIVE_TAGS.join(','))
  return args
}

export const TOOLS: Record<ToolId, ToolDef> = {
  nmap: {
    id: 'nmap', label: 'Nmap', image: 'instrumentisto/nmap:7.95', targetType: 'host', acceptsCidr: true, timeoutSec: 900,
    // -sT (connect scan) needs no raw-socket capability, so the container keeps zero extra caps.
    args: (t) => ['-sT', '-sV', '-Pn', '-T3', '-oX', '-', '--', t],
    parse: (o) => parseNmap(o),
  },
  subfinder: {
    id: 'subfinder', label: 'Subfinder', image: 'projectdiscovery/subfinder:v2.6.7', targetType: 'domain', network: 'internet', timeoutSec: 300,
    args: (t) => ['-d', t, '-silent', '-oJ'],
    parse: (o, _t, exitCode) => parseSubfinder(o, exitCode),
  },
  gobuster: {
    id: 'gobuster', label: 'Gobuster', image: 'ghcr.io/oj/gobuster@sha256:e5fb10a171d049aa15c4a6dc69aad2b7be86ddbb99c5216ec1195a0c380a2eb2', targetType: 'url', timeoutSec: 900,
    args: (t, o) => ['dir', '-u', t, '-w', o.wordlist ?? '/wordlists/common.txt', '--no-color', '--no-progress'],
    // Single-page apps answer 200 to every path. Gobuster reports that page's length; re-run ignoring it.
    retry: (r) => {
      const m = /non existing urls.*\(Length: (\d+)\)/.exec(r.stderr)
      return m ? ['--exclude-length', m[1]] : null
    },
    parse: (o, t) => parseGobuster(o, t),
  },
  'enum4linux-ng': {
    id: 'enum4linux-ng', label: 'Enum4Linux-NG', image: 'naqb/enum4linux-ng:1.3.4', targetType: 'host', timeoutSec: 600,
    args: (t) => ['-A', '-oJ', '/dev/stdout', t],
    parse: (o, t) => parseEnum4linux(o, t),
  },
  'ftp-scan': {
    id: 'ftp-scan', label: 'FTP-Scan', image: 'naqb/ftp-scan:0.1.0', targetType: 'host', timeoutSec: 300,
    args: (t) => ['--json', t],
    parse: (o) => parseFtpScan(o),
  },
  nuclei: {
    id: 'nuclei', label: 'Nuclei', image: 'projectdiscovery/nuclei:v3.11.1', targetType: 'url', timeoutSec: 1200,
    // Loading the full (or cves) template set needs well over the 512MB default; it gets OOM-killed otherwise.
    memory: '2g',
    volumes: [{ source: 'naqb-nuclei-templates', target: '/templates' }],
    args: (t, o) => nucleiArgs(t, o),
    parse: (o, _t, exitCode) => parseNuclei(o, exitCode),
  },
  nikto: {
    id: 'nikto', label: 'Nikto', image: 'ghcr.io/sullo/nikto:2.6.1', targetType: 'url', timeoutSec: 1200,
    entrypoint: ['sh', '-c', 'perl /opt/nikto/nikto.pl "$@" -output /tmp/nikto.json -Format json -ask no -maxtime 540s >&2; cat /tmp/nikto.json', 'nikto'],
    args: (t) => ['-h', t],
    parse: (o) => parseNikto(o),
  },
  'xss-probe': {
    // Runs a real headless browser against the target and watches for a real alert()/confirm()/
    // prompt() carrying a unique per-test marker — catches DOM-based XSS (payload only ever appears
    // in the DOM after client-side JS inserts it, never in any HTTP response body) that a classic
    // HTTP-response-scanning active scanner cannot see. Runs as a host process, not a container: see
    // the `execute` field's doc comment above for why.
    id: 'xss-probe', label: 'XSS Probe', execute: 'host', hostScript: 'native-tools/xss-probe/detect.mjs',
    targetType: 'url', timeoutSec: 420,
    args: (t) => [t, '--quiet'],
    parse: (o, t) => parseXssProbe(o, t),
  },
}
