import { fileURLToPath } from 'node:url'

function need(name) {
  const v = process.env[name]
  if (!v) { console.error(`Missing required environment variable ${name}`); process.exit(1) }
  return v
}

export const config = {
  // Anchor for resolving a 'host'-execute tool's repo-relative `hostScript` (e.g. xss-probe),
  // regardless of the worker process's own current directory.
  repoRoot: fileURLToPath(new URL('../../../', import.meta.url)),
  supabaseUrl: need('SUPABASE_URL'),
  // Secret key: server only. It must never be bundled into the web app.
  secretKey: need('SUPABASE_SECRET_KEY'),
  /** Docker network that can reach ONLY the lab (create it with an internal/firewalled bridge). */
  network: process.env.NAQB_LAB_NETWORK ?? 'naqb-lab',
  /** Only for passive tools (Subfinder) that must query public sources. */
  internetNetwork: process.env.NAQB_INTERNET_NETWORK ?? 'bridge',
  pollMs: Number(process.env.NAQB_POLL_MS ?? 2000),
  /** Host directory with wordlists, mounted read-only at /wordlists. */
  wordlistDir: process.env.NAQB_WORDLIST_DIR || fileURLToPath(new URL('../../../infra/wordlists', import.meta.url)),
  limits: {
    memory: process.env.NAQB_MEMORY ?? '512m',
    cpus: Number(process.env.NAQB_CPUS ?? 1),
    maxOutputBytes: Number(process.env.NAQB_MAX_OUTPUT_BYTES ?? 5_000_000),
  },
}
