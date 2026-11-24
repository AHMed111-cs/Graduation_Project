import { createClient } from '@supabase/supabase-js'
import { ParseError, TOOLS, adaptTarget, dedupeKey, isInScope, isSafeTarget } from '@naqb/shared'
import { join } from 'node:path'
import { config } from './config.js'
import { runContainer, runHostProcess } from './docker.js'

const db = createClient(config.supabaseUrl, config.secretKey, { auth: { persistSession: false } })

async function audit(projectId, action, detail) {
  await db.from('audit_log').insert({ project_id: projectId, action, detail })
}

async function fail(job, message) {
  await db.from('scan_jobs').update({ status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() }).eq('id', job.id)
}

async function processJob(job) {
  const tool = TOOLS[job.tool]
  if (!tool) return fail(job, `Unknown tool "${job.tool}"`)

  // 0. The tester may type an IP, URL or domain; turn it into what THIS tool needs (or fail clearly).
  const adapted = adaptTarget(tool, job.target)
  if (!adapted.ok) return fail(job, adapted.error)
  job = { ...job, typedTarget: job.target, target: adapted.target }

  // 1. Scope is checked HERE, by the worker, regardless of what the UI or API did.
  if (!isSafeTarget(job.target)) {
    await audit(job.project_id, 'scan_rejected_unsafe_target', { job: job.id, target: job.target })
    return fail(job, 'Rejected: target contains characters that are not allowed.')
  }
  const { data: scope, error: scopeErr } = await db.from('scope_entries').select('kind,value').eq('project_id', job.project_id)
  if (scopeErr) return fail(job, `Could not read scope: ${scopeErr.message}`)
  if (!isInScope(job.target, scope ?? [])) {
    await audit(job.project_id, 'scan_rejected_out_of_scope', { job: job.id, target: job.target, tool: job.tool, launched_by: job.launched_by })
    return fail(job, `Rejected: ${job.target} is outside this project's scope.`)
  }

  // 2. Build the argument list. Disruptive nuclei templates need an explicit Team Lead decision.
  const options = { ...(job.options ?? {}) }
  if (options.allowDisruptive) {
    const { data: p } = await db.from('profiles').select('role').eq('id', job.launched_by).single()
    if (p?.role !== 'team_lead') options.allowDisruptive = false
  }
  if (tool.id === 'gobuster' && options.wordlist) options.wordlist = '/wordlists/' + String(options.wordlist).replace(/[^A-Za-z0-9._-]/g, '')
  let args
  try { args = tool.args(job.target, options) } catch (e) { return fail(job, e.message) }

  await db.from('scan_jobs').update({ image: tool.image ?? null }).eq('id', job.id)

  // 3. Run in a fresh container (or, for a 'host'-execute tool, a plain process on this machine —
  // see tools.ts); stream output to job_output_chunks (Realtime pushes it to the UI) either way.
  let buffer = ''
  let flushing = Promise.resolve()
  const flush = () => {
    if (!buffer) return
    const chunk = buffer; buffer = ''
    flushing = flushing.then(() => db.from('job_output_chunks').insert({ job_id: job.id, project_id: job.project_id, chunk })).catch(() => {})
  }
  const flushTimer = setInterval(flush, 500)
  const shouldCancel = async () => (await db.from('scan_jobs').select('cancel_requested').eq('id', job.id).single()).data?.cancel_requested === true
  const limits = { ...config.limits, timeoutSec: tool.timeoutSec, memory: tool.memory ?? config.limits.memory }

  const exec = tool.execute === 'host'
    ? (extra) => runHostProcess({
        command: 'node', args: [join(config.repoRoot, tool.hostScript), ...args, ...extra],
        limits, onChunk: (d) => { buffer += d }, shouldCancel,
      })
    : (extra, suffix) => {
        const mounts = [
          ...(config.wordlistDir ? [{ host: config.wordlistDir, container: '/wordlists' }] : []),
          ...(tool.volumes ?? []).map((v) => ({ host: v.source, container: v.target })),
        ]
        return runContainer({
          name: `naqb-job-${job.id}${suffix}`, image: tool.image, args: [...args, ...extra], entrypoint: tool.entrypoint,
          network: tool.network === 'internet' ? config.internetNetwork : config.network, mounts,
          limits, onChunk: (d) => { buffer += d }, shouldCancel,
        })
      }
  let run = await exec([], '')
  const extra = run.exitCode !== 0 && !run.timedOut && !run.cancelled && tool.retry ? tool.retry(run) : null
  if (extra) { buffer += `
[naqb] re-running with ${extra.join(' ')}
`; run = await exec(extra, '-retry') }
  clearInterval(flushTimer); flush(); await flushing

  await db.from('scan_jobs').update({ raw_output: run.stdout + (run.stderr ? '\n--- stderr ---\n' + run.stderr : '') }).eq('id', job.id)

  const proc = tool.execute === 'host' ? 'process' : 'container'
  if (run.cancelled) return fail(job, 'Cancelled by user.')
  if (run.timedOut) return fail(job, `Timed out after ${tool.timeoutSec}s; the ${proc} was stopped.`)
  if (run.truncated) return fail(job, `Output exceeded ${config.limits.maxOutputBytes} bytes; the ${proc} was stopped.`)

  // 4. Parse. Bad output becomes a clear failed job, never a crash or a silent empty result.
  let parsed
  try {
    parsed = tool.parse(run.stdout, job.target, run.exitCode)
  } catch (e) {
    const msg = e instanceof ParseError ? e.message : `Parser crashed: ${e.message}`
    const hint = run.exitCode ? ` (tool exit code ${run.exitCode}: ${run.stderr.trim().slice(-300)})` : ''
    return fail(job, msg + hint)
  }

  // 5. Upsert on (project_id, dedupe_key): a re-run refreshes last_seen instead of duplicating.
  const now = new Date().toISOString()
  const rows = parsed.map((r) => ({
    project_id: job.project_id, job_id: job.id, tool: job.tool, kind: r.kind, host: r.host, port: r.port ?? null,
    // Only a vulnerability-kind result has a severity; everything else leaves it null, not 'info'.
    value: r.value, title: r.title, severity: r.severity ?? null, data: r.data, dedupe_key: dedupeKey(r), last_seen: now,
  }))
  const seen = new Map(rows.map((r) => [r.dedupe_key, r])) // collapse duplicates inside one run
  for (let i = 0; i < seen.size; i += 500) {
    const batch = [...seen.values()].slice(i, i + 500)
    const { error } = await db.from('results').upsert(batch, { onConflict: 'project_id,dedupe_key' })
    if (error) return fail(job, `Saving results failed: ${error.message}`)
  }
  await db.from('scan_jobs').update({ status: 'completed', error: null, finished_at: new Date().toISOString() }).eq('id', job.id)
  console.log(`job ${job.id} ${job.tool} ${job.target}: completed, ${seen.size} results`)
}

async function loop() {
  console.log('NAQB worker started')
  for (;;) {
    try {
      const { data, error } = await db.rpc('claim_next_job')
      if (error) throw error
      const job = Array.isArray(data) ? data[0] : data
      if (job) {
        try { await processJob(job) } catch (e) { console.error(e); await fail(job, `Worker error: ${e.message}`) }
        continue
      }
    } catch (e) { console.error('queue error:', e.message) }
    await new Promise((r) => setTimeout(r, config.pollMs))
  }
}

// On start, jobs left "running" by a crashed worker would hang forever: mark them failed.
await db.from('scan_jobs').update({ status: 'failed', error: 'Worker restarted while this job was running.', finished_at: new Date().toISOString() }).eq('status', 'running')
loop()
