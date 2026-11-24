import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, Ban, Bug, CalendarDays, Check, ChevronDown, ChevronRight, CircleCheck, CircleX, Copy, Database, Globe, Play, Plus, Radar,
  Download, ScanSearch, Search, Server, ShieldCheck, Target, Terminal, Trash2, UserMinus, UserPlus, Users, TriangleAlert, Building2,
} from 'lucide-react'
import { NUCLEI_MODULES, TOOLS, TOOL_IDS, adaptTarget, isInScope, isSafeTarget, type ScopeEntry, type ToolId } from '@naqb/shared'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  Avatar, Donut, EmptyState, ErrorNote, KINDS, KindLabel, PageHeader, SEVERITIES, SEV_HEX, SegBar, SeverityBadge, StatusBadge,
  TOOL_BLURB, TOOL_ICON, duration, timeAgo, useNow,
} from '../components/ui'

type Tab = 'scans' | 'results' | 'scope' | 'members'
interface Job { id: string; tool: string; target: string; status: string; error: string | null; launched_by: string; created_at: string; started_at: string | null; finished_at: string | null }
interface ResultRow { id: string; tool: string; kind: string; host: string; port: number | null; value: string; title: string; severity: string | null; first_seen: string; last_seen: string }

/* ───────────── shared queries ───────────── */
const useScope = (projectId: string) => useQuery({ queryKey: ['scope', projectId], queryFn: async () => {
  const { data, error } = await supabase.from('scope_entries').select('*').eq('project_id', projectId).order('created_at')
  if (error) throw error
  return data as (ScopeEntry & { id: string })[]
} })
const useJobs = (projectId: string) => useQuery({ queryKey: ['jobs', projectId], queryFn: async () => {
  const { data, error } = await supabase.from('scan_jobs').select('id,tool,target,status,error,launched_by,created_at,started_at,finished_at,image').eq('project_id', projectId).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return data as Job[]
} })
const useResults = (projectId: string) => useQuery({ queryKey: ['results', projectId], queryFn: async () => {
  const { data, error } = await supabase.from('results').select('id,tool,kind,host,port,value,title,severity,first_seen,last_seen').eq('project_id', projectId).order('last_seen', { ascending: false }).limit(2000)
  if (error) throw error
  return data as ResultRow[]
} })

function phaseOf(start: string | null, end: string | null) {
  const today = new Date().toISOString().slice(0, 10)
  if (start && today < start) return { label: 'Upcoming', cls: 'border-blue-500/30 bg-blue-500/10 text-blue-300' }
  if (end && today > end) return { label: 'Ended', cls: 'border-line-strong bg-raised text-muted' }
  return { label: 'Active', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' }
}
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '…')

/** Scanner output is untrusted: a cell starting with = + - @ would run as a formula in Excel, so it is prefixed with an apostrophe. */
function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t
  return `"${t.replace(/"/g, '""')}"`
}
function exportCsv(rows: ResultRow[], name: string) {
  const head = ['type', 'title', 'host', 'port', 'severity', 'tool', 'value', 'first_seen', 'last_seen']
  const body = rows.map((r) => [r.kind, r.title, r.host, r.port, r.severity, r.tool, r.value, r.first_seen, r.last_seen].map(csvCell).join(','))
  const blob = new Blob(['﻿' + [head.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w.-]+/g, '_')}-results.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function copy(text: string) { try { await navigator.clipboard.writeText(text); return true } catch { return false } }

/* ───────────── page ───────────── */
export function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const { isLead } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('scans')
  const project = useQuery({ queryKey: ['project', id], queryFn: async () => {
    const { data, error } = await supabase.from('projects').select('*').eq('id', id!).single()
    if (error) throw error
    return data
  } })
  const jobs = useJobs(id!)
  const results = useResults(id!)
  useEffect(() => { document.title = project.data ? `NAQB · ${project.data.name}` : 'NAQB' }, [project.data])

  // One live subscription for the whole project: status changes refresh both the scan list and the results.
  useEffect(() => {
    if (!id) return
    const ch = supabase.channel(`project-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scan_jobs', filter: `project_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ['jobs', id] }); qc.invalidateQueries({ queryKey: ['results', id] })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id, qc])

  if (project.isLoading) return <div className="space-y-4"><div className="skeleton h-10 w-72" /><div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}</div></div>
  if (project.error || !project.data) {
    return <div className="card"><EmptyState icon={ShieldCheck} title="Project not found" hint="It does not exist, or you are not a member of it." /></div>
  }
  const p = project.data
  const ph = phaseOf(p.start_date, p.end_date)
  const rows = results.data ?? []
  const active = (jobs.data ?? []).filter((j) => j.status === 'running' || j.status === 'queued').length

  const tabs: { key: Tab; label: string; icon: typeof Radar; count?: number }[] = [
    { key: 'scans', label: 'Scans', icon: Radar, count: jobs.data?.length },
    { key: 'results', label: 'Results', icon: Database, count: rows.length },
    { key: 'scope', label: 'Scope & assets', icon: Target },
  ]
  if (isLead) tabs.push({ key: 'members', label: 'Members', icon: Users })
  const sevData = SEVERITIES.map((sv) => ({ label: sv, value: rows.filter((r) => r.severity === sv).length, color: SEV_HEX[sv] }))
  const hosts = rows.filter((r) => r.kind === 'host').length
  const vulns = rows.filter((r) => r.kind === 'vulnerability').length

  return (
    <div>
      <SegBar data={sevData} label="Results" />
      <PageHeader back={{ to: '/projects', label: 'Projects' }} title={p.name}
        actions={<span className={`badge ${ph.cls} px-3 py-1 text-xs`}>{ph.label}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><Building2 size={14} aria-hidden />{p.client ?? 'No client'}</span>
          {p.start_date && <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden />{fmtDate(p.start_date)} → {fmtDate(p.end_date)}</span>}
        </span>} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <div role="tablist" aria-label="Project sections" aria-orientation="vertical" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={`group flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${tab === t.key ? 'border-naqb/60 bg-naqb/10 text-fg' : 'border-transparent text-muted hover:bg-hover hover:text-fg'}`}>
                <t.icon size={16} className={tab === t.key ? 'text-naqb' : ''} aria-hidden />
                <span className="flex-1">{t.label}</span>
                {t.count !== undefined && <span className="rounded-full bg-bg px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted ring-1 ring-line">{t.count}</span>}
              </button>
            ))}
          </div>

          <section aria-label="Results overview" className="hidden border-t border-line pt-4 lg:block">
            <h2 className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-faint">Results overview</h2>
            {results.isLoading ? <div className="skeleton h-24" /> : <Donut compact size={92} data={sevData} />}
            <dl className="mt-4 space-y-2 text-sm">
              {([['Hosts', hosts, Server], ['Vulnerability-class', vulns, Bug], ['Active scans', active, Activity]] as const).map(([l, v, I]) => (
                <div key={l} className="flex items-center justify-between text-muted">
                  <dt className="flex items-center gap-2"><I size={14} aria-hidden />{l}</dt>
                  <dd className="font-mono tabular-nums text-fg">{v}{l === 'Active scans' && v > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400 align-middle" />}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] leading-snug text-faint">Scanner output only. Possible issues are not confirmed.</p>
          </section>
        </aside>

        <div key={tab} className="min-w-0 animate-fade-in" role="tabpanel">
          {tab === 'scans' && <Scans projectId={id!} />}
          {tab === 'results' && <Results projectId={id!} />}
          {tab === 'scope' && <ScopeAssets projectId={id!} />}
          {tab === 'members' && isLead && <Members projectId={id!} />}
        </div>
      </div>
    </div>
  )
}

/* ───────────── Scans: launch, status, live output ───────────── */
function Scans({ projectId }: { projectId: string }) {
  const { session, isLead } = useAuth()
  const qc = useQueryClient()
  const scope = useScope(projectId)
  const jobs = useJobs(projectId)
  const [tool, setTool] = useState<ToolId>('nmap')
  const [target, setTarget] = useState('')
  const [module, setModule] = useState('basic')
  const [disruptive, setDisruptive] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const now = useNow((jobs.data ?? []).some((j) => j.status === 'running'))

  // Any input works: it is converted to what the chosen tool needs. `blocked` stops the launch, `info` is just a preview.
  const check = useMemo(() => {
    if (!target.trim()) return { blocked: false, adapted: null as string | null, warn: null as string | null, outOfScope: false }
    const a = adaptTarget(TOOLS[tool], target)
    if (!a.ok) return { blocked: true, adapted: null, warn: a.error, outOfScope: false }
    if (!isSafeTarget(a.target)) return { blocked: true, adapted: null, warn: 'This target contains characters that are not allowed.', outOfScope: false }
    const out = !!scope.data && !isInScope(a.target, scope.data)
    return { blocked: false, adapted: a.target, warn: out ? 'Outside the project scope: the worker will reject it.' : null, outOfScope: out }
  }, [target, tool, scope.data])

  const launch = useMutation({
    mutationFn: async () => {
      const options: Record<string, unknown> = {}
      if (tool === 'nuclei') { options.module = module; if (isLead && disruptive) options.allowDisruptive = true }
      const { error } = await supabase.from('scan_jobs').insert({ project_id: projectId, tool, target: target.trim(), options, launched_by: session!.user.id })
      if (error) throw error
    },
    onSuccess: () => { setTarget(''); qc.invalidateQueries({ queryKey: ['jobs', projectId] }) },
  })
  const cancel = useMutation({
    mutationFn: async (jobId: string) => { const { error } = await supabase.from('scan_jobs').update({ cancel_requested: true }).eq('id', jobId); if (error) throw error },
  })
  const del = useMutation({
    mutationFn: async (jobId: string) => { const { error } = await supabase.from('scan_jobs').delete().eq('id', jobId); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs', projectId] }); qc.invalidateQueries({ queryKey: ['results', projectId] }) },
  })

  const list = jobs.data ?? []
  return (
    <div className="space-y-6">
      <form className="card card-pad" onSubmit={(e) => { e.preventDefault(); if (target.trim() && !check.blocked) launch.mutate() }}>
        <h2 className="card-title mb-4">New scan</h2>
        <fieldset>
          <legend className="label">Tool</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {TOOL_IDS.map((t) => {
              const Icon = TOOL_ICON[t] ?? ScanSearch
              const on = tool === t
              return (
                <button type="button" key={t} aria-pressed={on} onClick={() => setTool(t)}
                  className={`flex flex-col items-start justify-start rounded-lg border p-3 text-left transition ${on ? 'border-naqb/70 bg-naqb/10' : 'border-line-strong bg-bg hover:border-faint hover:bg-raised'}`}>
                  <Icon size={18} className={on ? 'text-naqb' : 'text-muted'} aria-hidden />
                  <p className="mt-2 text-sm font-semibold">{TOOLS[t].label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-faint">{TOOL_BLURB[t]}</p>
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div>
            <label className="label" htmlFor="scan-target">Target</label>
            <div className="relative">
              <Target size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
              <input id="scan-target" className="input mono pl-10" value={target} onChange={(e) => setTarget(e.target.value)} autoComplete="off" spellCheck={false}
                placeholder="10.10.0.5, example.com or http://10.10.0.5:3000" />
            </div>
            <p className="mt-1.5 text-xs text-faint">Any IP, domain or URL works. It is converted to what {TOOLS[tool].label} needs.</p>
          </div>
          <div className="flex items-end gap-3">
            {tool === 'nuclei' && (
              <div>
                <label className="label" htmlFor="nuclei-module">Module</label>
                <select id="nuclei-module" className="input w-36" value={module} onChange={(e) => setModule(e.target.value)}>{NUCLEI_MODULES.map((m) => <option key={m}>{m}</option>)}</select>
              </div>
            )}
            <button className="btn h-[38px] px-5" disabled={launch.isPending || !target.trim() || check.blocked}>
              <Play size={15} aria-hidden />{launch.isPending ? 'Queuing…' : 'Launch scan'}
            </button>
          </div>
        </div>
        {tool === 'nuclei' && isLead && (
          <label className="mt-3 flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="accent-[#e91b25]" checked={disruptive} onChange={(e) => setDisruptive(e.target.checked)} />Allow disruptive templates (dos, fuzz, intrusive)</label>
        )}

        <div className="mt-4 space-y-2 empty:hidden">
          {check.adapted && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">{TOOLS[tool].label} will scan</span>
              <code className="mono rounded-md bg-bg px-2 py-0.5 ring-1 ring-line-strong">{check.adapted}</code>
              {check.outOfScope
                ? <span className="badge border-amber-500/30 bg-amber-500/10 text-amber-300"><TriangleAlert size={12} aria-hidden />Outside scope</span>
                : scope.data && <span className="badge border-emerald-500/30 bg-emerald-500/10 text-emerald-300"><Check size={12} aria-hidden />In scope</span>}
            </div>
          )}
          {check.warn && <p className="flex items-center gap-2 text-sm text-amber-300"><TriangleAlert size={15} aria-hidden />{check.warn}</p>}
          {launch.error && <ErrorNote error={launch.error} />}
        </div>
      </form>

      <div className="card overflow-hidden">
        <div className="panel-head"><h2 className="card-title">Scan history</h2><span className="text-xs text-faint">Updates live</span></div>
        {jobs.isLoading ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 w-full" />)}</div>
          : list.length === 0 ? <EmptyState icon={Radar} title="No scans yet" hint="Pick a tool and a target above. Scans on targets outside the project scope are rejected." />
          : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th className="w-8" /><th>Status</th><th>Tool</th><th>Target</th><th>Duration</th><th>Started</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {list.map((j) => {
                    const Icon = TOOL_ICON[j.tool] ?? ScanSearch
                    const isOpen = open === j.id
                    const canCancel = (j.status === 'queued' || j.status === 'running') && (isLead || j.launched_by === session?.user.id)
                    return (
                      <JobRows key={j.id} colSpan={7} open={isOpen}
                        row={(
                          <tr className="row-click" onClick={() => setOpen(isOpen ? null : j.id)}>
                            <td className="pr-0 text-faint">{isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</td>
                            <td><StatusBadge status={j.status} /></td>
                            <td><span className="inline-flex items-center gap-2 font-medium"><Icon size={15} className="text-muted" aria-hidden />{TOOLS[j.tool as ToolId]?.label ?? j.tool}</span></td>
                            <td className="mono max-w-[300px] truncate text-muted" title={j.target}>{j.target}</td>
                            <td className="tabular-nums text-muted">{duration(j.started_at, j.finished_at, now)}</td>
                            <td className="whitespace-nowrap text-muted" title={new Date(j.created_at).toLocaleString()}>{timeAgo(j.created_at, now)}</td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-2">
                                <button className="btn-ghost" onClick={() => setOpen(isOpen ? null : j.id)}><Terminal size={14} aria-hidden />{isOpen ? 'Hide' : 'Output'}</button>
                                {canCancel && <button className="btn-ghost" onClick={() => cancel.mutate(j.id)}><Ban size={14} aria-hidden />Cancel</button>}
                                {isLead && <button className="btn-danger" aria-label="Delete scan" onClick={() => { if (confirm('Delete this run and its results?')) del.mutate(j.id) }}><Trash2 size={14} aria-hidden />Delete</button>}
                              </div>
                            </td>
                          </tr>
                        )}
                        detail={<>
                          {j.error && <p className="mb-3 flex items-start gap-2 rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300"><CircleX size={16} className="mt-0.5 shrink-0" aria-hidden />{j.error}</p>}
                          <Output jobId={j.id} projectId={projectId} status={j.status} label={`${TOOLS[j.tool as ToolId]?.label ?? j.tool} → ${j.target}`} />
                        </>}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {(cancel.error || del.error) && <ErrorNote error={cancel.error ?? del.error} />}
    </div>
  )
}

/** A table row plus an optional full-width detail row beneath it. A job's error is shown even when collapsed. */
function JobRows({ row, detail, open, colSpan }: { row: ReactNode; detail: ReactNode; open: boolean; colSpan: number }) {
  return (
    <>
      {row}
      {open && <tr><td colSpan={colSpan} className="bg-bg/60 !p-4 animate-fade-in">{detail}</td></tr>}
    </>
  )
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g

/** Live output via Realtime inserts; once finished, shows the stored raw output instead. Plain text only. */
function Output({ jobId, projectId, status, label }: { jobId: string; projectId: string; status: string; label: string }) {
  const [text, setText] = useState('')
  const [raw, setRaw] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => {
    let alive = true
    setText('')
    supabase.from('job_output_chunks').select('chunk').eq('job_id', jobId).order('id').then(({ data }) => { if (alive && data) setText(data.map((d) => d.chunk).join('')) })
    const ch = supabase.channel(`out-${jobId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_output_chunks', filter: `job_id=eq.${jobId}` }, (p) => setText((t) => t + (p.new as { chunk: string }).chunk))
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [jobId, projectId])
  useEffect(() => {
    if (status === 'completed' || status === 'failed')
      supabase.from('scan_jobs').select('raw_output').eq('id', jobId).single().then(({ data }) => setRaw(data?.raw_output ?? null))
  }, [jobId, status])
  const shown = (raw ?? text).replace(ANSI, '')
  useEffect(() => { if (status === 'running' && box.current) box.current.scrollTop = box.current.scrollHeight }, [shown, status])
  const lines = shown ? shown.split('\n').length : 0
  return (
    <div className="overflow-hidden rounded-lg border border-line-strong bg-[#06080b]">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex gap-1.5" aria-hidden><i className="h-2.5 w-2.5 rounded-full bg-rose-500/70" /><i className="h-2.5 w-2.5 rounded-full bg-amber-400/70" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" /></span>
          <span className="mono truncate text-xs text-muted">{label}</span>
          {status === 'running' && <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />LIVE</span>}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-faint">
          <span className="tabular-nums">{lines} lines</span>
          <button className="inline-flex items-center gap-1 text-muted transition hover:text-fg" disabled={!shown}
            onClick={async () => { if (await copy(shown)) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }}>
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre ref={box} className="mono max-h-96 overflow-auto whitespace-pre-wrap break-all p-4 leading-relaxed text-emerald-100/90">
        {shown || <span className="text-faint">{status === 'queued' ? 'Waiting in the queue…' : 'No output yet.'}</span>}
      </pre>
    </div>
  )
}

/* ───────────── Results: one table per project ───────────── */
const PAGE = 50

function ResultDetail({ r }: { r: ResultRow }) {
  const q = useQuery({ queryKey: ['result-data', r.id], queryFn: async () => {
    const { data, error } = await supabase.from('results').select('data').eq('id', r.id).single()
    if (error) throw error
    return (data?.data ?? {}) as Record<string, unknown>
  } })
  const entries = Object.entries(q.data ?? {}).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
  const asText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <dl className="space-y-3 text-sm">
        <div><dt className="label">Value</dt><dd className="mono break-all">{r.value}</dd></div>
        <div className="grid grid-cols-2 gap-3">
          <div><dt className="label">First seen</dt><dd className="text-muted">{new Date(r.first_seen).toLocaleString()}</dd></div>
          <div><dt className="label">Last seen</dt><dd className="text-muted">{new Date(r.last_seen).toLocaleString()}</dd></div>
        </div>
        <p className="text-xs text-faint">Scanner output. Not reviewed or verified.</p>
      </dl>
      <div>
        <p className="label">Details</p>
        {q.isLoading ? <div className="skeleton h-20" /> : entries.length === 0 ? <p className="text-sm text-muted">No extra details.</p> : (
          <dl className="space-y-2 text-sm">
            {entries.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-3">
                <dt className="text-xs text-faint">{k.replace(/_/g, ' ')}</dt>
                <dd className="mono min-w-0 whitespace-pre-wrap break-all text-muted">{asText(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}

function Results({ projectId }: { projectId: string }) {
  const q = useResults(projectId)
  const [sev, setSev] = useState('')
  const [kind, setKind] = useState('')
  const [tool, setTool] = useState('')
  const [search, setSearch] = useState('')
  const [bySeverity, setBySeverity] = useState(false)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { setPage(0) }, [sev, kind, tool, search, bySeverity])

  const all = q.data ?? []
  const sevCount = useMemo(() => Object.fromEntries(SEVERITIES.map((s) => [s, all.filter((r) => r.severity === s).length])) as Record<string, number>, [all])
  const rank = (s: string | null) => { const i = s === null ? -1 : (SEVERITIES as readonly string[]).indexOf(s); return i === -1 ? 99 : i }
  const rows = useMemo(() => {
    const f = all.filter((r) => (!sev || r.severity === sev) && (!kind || r.kind === kind) && (!tool || r.tool === tool) && (!search || `${r.host} ${r.value} ${r.title}`.toLowerCase().includes(search.toLowerCase())))
    return bySeverity ? [...f].sort((a, b) => rank(a.severity) - rank(b.severity)) : f
  }, [all, sev, kind, tool, search, bySeverity])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE)
  const filtered = !!(sev || kind || tool || search)

  return (
    <div className="space-y-4">
      <div className="card card-pad space-y-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by severity">
          <button className="chip" aria-pressed={!sev} onClick={() => setSev('')}>All <span className="tabular-nums text-faint">{all.length}</span></button>
          {SEVERITIES.map((s) => (
            <button key={s} className="chip" aria-pressed={sev === s} onClick={() => setSev(sev === s ? '' : s)} disabled={sevCount[s] === 0 && sev !== s} style={sevCount[s] === 0 && sev !== s ? { opacity: 0.45 } : undefined}>
              <span className="h-2 w-2 rounded-full" style={{ background: SEV_HEX[s] }} aria-hidden />{s}<span className="tabular-nums text-faint">{sevCount[s]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-56 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <input className="input pl-9" placeholder="Search host, value or title…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search results" />
          </div>
          <select className="input w-40" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by type"><option value="">All types</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
          <select className="input w-40" value={tool} onChange={(e) => setTool(e.target.value)} aria-label="Filter by tool"><option value="">All tools</option>{TOOL_IDS.map((t) => <option key={t} value={t}>{TOOLS[t].label}</option>)}</select>
          <button className="chip" aria-pressed={bySeverity} onClick={() => setBySeverity(!bySeverity)}>Severity first</button>
          {filtered && <button className="btn-ghost" onClick={() => { setSev(''); setKind(''); setTool(''); setSearch('') }}>Clear filters</button>}
          <button className="btn-ghost ml-auto" disabled={rows.length === 0} onClick={() => exportCsv(rows, 'naqb')}><Download size={14} aria-hidden />Export CSV</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="panel-head">
          <h2 className="card-title">{rows.length.toLocaleString()} result{rows.length === 1 ? '' : 's'}{filtered ? ' (filtered)' : ''}</h2>
          <span className="text-xs text-faint">Scanner output only. Nothing here has been reviewed or verified.</span>
        </div>
        {q.error && <div className="p-5"><ErrorNote error={q.error} /></div>}
        {q.isLoading ? <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10 w-full" />)}</div>
          : rows.length === 0
            ? <EmptyState icon={Database} title={filtered ? 'No results match these filters' : 'No results yet'} hint={filtered ? 'Try clearing a filter.' : 'Launch a scan from the Scans tab. Parsed results appear here.'} />
            : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th className="w-8" /><th>Type</th><th>Found</th><th>Target</th><th>Severity</th><th>Tool</th><th>Last seen</th></tr></thead>
                  <tbody>
                    {shown.map((r) => {
                      const isOpen = open === r.id
                      const Icon = TOOL_ICON[r.tool] ?? ScanSearch
                      return (
                        <JobRows key={r.id} colSpan={7} open={isOpen}
                          row={(
                            <tr className="row-click" onClick={() => setOpen(isOpen ? null : r.id)}>
                              <td className="pr-0 text-faint">{isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</td>
                              <td><KindLabel kind={r.kind} /></td>
                              <td className="max-w-[460px] break-words">{r.title}</td>
                              <td className="mono whitespace-nowrap text-muted">{r.host}{r.port ? `:${r.port}` : ''}</td>
                              <td><SeverityBadge severity={r.severity} /></td>
                              <td><span className="inline-flex items-center gap-1.5 text-muted"><Icon size={14} aria-hidden />{TOOLS[r.tool as ToolId]?.label ?? r.tool}</span></td>
                              <td className="whitespace-nowrap text-xs text-muted" title={new Date(r.last_seen).toLocaleString()}>{timeAgo(r.last_seen)}</td>
                            </tr>
                          )}
                          detail={<ResultDetail r={r} />} />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        {rows.length > PAGE && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
            <span className="tabular-nums">{page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}</span>
            <div className="flex gap-2">
              <button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn-ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────────── Scope (lead) and assets (members) ───────────── */
const KIND_OPTS = ['ip', 'cidr', 'domain', 'url']
function KindChip({ kind }: { kind: string }) {
  return <span className="inline-flex w-16 justify-center rounded-md bg-raised px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted ring-1 ring-line-strong">{kind}</span>
}

function ScopeAssets({ projectId }: { projectId: string }) {
  const { isLead, session } = useAuth()
  const qc = useQueryClient()
  const scope = useScope(projectId)
  const assets = useQuery({ queryKey: ['assets', projectId], queryFn: async () => {
    const { data, error } = await supabase.from('assets').select('*').eq('project_id', projectId).order('created_at')
    if (error) throw error
    return data
  } })
  const [sk, setSk] = useState('cidr'); const [sv, setSv] = useState('')
  const [ak, setAk] = useState('ip'); const [av, setAv] = useState('')
  const addScope = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('scope_entries').insert({ project_id: projectId, kind: sk, value: sv.trim() }); if (error) throw error },
    onSuccess: () => { setSv(''); qc.invalidateQueries({ queryKey: ['scope', projectId] }) },
  })
  const delScope = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('scope_entries').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scope', projectId] }),
  })
  const addAsset = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('assets').insert({ project_id: projectId, kind: ak, value: av.trim(), created_by: session!.user.id }); if (error) throw error },
    onSuccess: () => { setAv(''); qc.invalidateQueries({ queryKey: ['assets', projectId] }) },
  })
  const delAsset = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('assets').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets', projectId] }),
  })
  const kindSelect = (v: string, set: (s: string) => void, label: string) => <select className="input w-28 shrink-0" value={v} aria-label={label} onChange={(e) => set(e.target.value)}>{KIND_OPTS.map((k) => <option key={k}>{k}</option>)}</select>

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <div className="panel-head"><div><h2 className="card-title">Scope</h2><p className="text-xs text-faint">What scanners are allowed to touch. Set by the Team Lead.</p></div></div>
        <div className="card-pad space-y-4">
          {isLead && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (sv.trim()) addScope.mutate() }}>
              {kindSelect(sk, setSk, 'Scope type')}<input className="input mono" aria-label="Scope value" value={sv} onChange={(e) => setSv(e.target.value)} placeholder="10.10.0.0/24" />
              <button className="btn shrink-0" disabled={!sv.trim() || addScope.isPending}><Plus size={15} aria-hidden />Add</button>
            </form>
          )}
          <ErrorNote error={addScope.error ?? delScope.error} />
          <ul className="space-y-2">
            {scope.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                <KindChip kind={s.kind} /><span className="mono min-w-0 flex-1 truncate">{s.value}</span>
                {isLead && <button className="icon-btn hover:!text-rose-300" aria-label={`Remove ${s.value}`} onClick={() => delScope.mutate(s.id)}><Trash2 size={15} /></button>}
              </li>
            ))}
          </ul>
          {scope.data?.length === 0 && <EmptyState icon={ShieldCheck} title="Scope is empty" hint="No scan can run until the Team Lead adds at least one entry." />}
        </div>
      </section>

      <section className="card">
        <div className="panel-head"><div><h2 className="card-title">Assets</h2><p className="text-xs text-faint">Targets you are working with. Scans still only run inside scope.</p></div></div>
        <div className="card-pad space-y-4">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (av.trim()) addAsset.mutate() }}>
            {kindSelect(ak, setAk, 'Asset type')}<input className="input mono" aria-label="Asset value" value={av} onChange={(e) => setAv(e.target.value)} placeholder="10.10.0.5" />
            <button className="btn shrink-0" disabled={!av.trim() || addAsset.isPending}><Plus size={15} aria-hidden />Add</button>
          </form>
          <ErrorNote error={addAsset.error ?? delAsset.error} />
          <ul className="space-y-2">
            {assets.data?.map((a) => {
              const inScope = scope.data ? isInScope(a.value, scope.data) : false
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                  <KindChip kind={a.kind} /><span className="mono min-w-0 flex-1 truncate">{a.value}</span>
                  <span className={`badge ${inScope ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>{inScope ? <Check size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />}{inScope ? 'in scope' : 'not in scope'}</span>
                  <button className="icon-btn hover:!text-rose-300" aria-label={`Remove ${a.value}`} onClick={() => delAsset.mutate(a.id)}><Trash2 size={15} /></button>
                </li>
              )
            })}
          </ul>
          {assets.data?.length === 0 && <EmptyState icon={Globe} title="No assets yet" hint="Add the hosts, ranges, domains or URLs for this engagement." />}
        </div>
      </section>
    </div>
  )
}

/* ───────────── Members (Team Lead) ───────────── */
function Members({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const [userId, setUserId] = useState('')
  const members = useQuery({ queryKey: ['members', projectId], queryFn: async () => {
    const { data, error } = await supabase.from('project_members').select('user_id').eq('project_id', projectId)
    if (error) throw error
    return data.map((d) => d.user_id as string)
  } })
  const users = useQuery({ queryKey: ['users'], queryFn: async () => {
    const { data, error } = await supabase.from('profiles').select('id,email,full_name').order('email')
    if (error) throw error
    return data
  } })
  const add = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('project_members').insert({ project_id: projectId, user_id: userId }); if (error) throw error },
    onSuccess: () => { setUserId(''); qc.invalidateQueries({ queryKey: ['members', projectId] }) },
  })
  const remove = useMutation({
    mutationFn: async (uid: string) => { const { error } = await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', uid); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', projectId] }),
  })
  const info = (uid: string) => users.data?.find((u) => u.id === uid)
  const candidates = users.data?.filter((u) => !members.data?.includes(u.id)) ?? []
  return (
    <div className="card max-w-2xl">
      <div className="panel-head"><div><h2 className="card-title">Members</h2><p className="text-xs text-faint">Pentesters only see projects they are a member of. Team Leads always have access.</p></div></div>
      <div className="card-pad space-y-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (userId) add.mutate() }}>
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="User to add"><option value="">Add a member…</option>{candidates.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}</select>
          <button className="btn shrink-0" disabled={!userId || add.isPending}><UserPlus size={15} aria-hidden />Add</button>
        </form>
        <ErrorNote error={add.error ?? remove.error} />
        <ul className="space-y-2">
          {members.data?.map((uid) => {
            const u = info(uid)
            return (
              <li key={uid} className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                <Avatar name={u?.full_name || u?.email || uid} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{u?.full_name || u?.email || uid}</p>{u?.full_name && <p className="truncate text-xs text-muted">{u.email}</p>}</div>
                <button className="btn-ghost" onClick={() => remove.mutate(uid)}><UserMinus size={14} aria-hidden />Remove</button>
              </li>
            )
          })}
        </ul>
        {members.data?.length === 0 && <EmptyState icon={CircleCheck} title="No members yet" hint="Add pentesters so they can see and work in this project." />}
      </div>
    </div>
  )
}
