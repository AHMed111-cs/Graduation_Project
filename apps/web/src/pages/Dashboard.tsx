import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Bug, CircleCheck, CircleX, Clock, Database, FolderKanban, Loader2, ScanSearch, type LucideIcon } from 'lucide-react'
import { TOOLS, type ToolId } from '@naqb/shared'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BarList, Donut, EmptyState, KIND_ICON, KINDS, PageHeader, SEVERITIES, SEV_HEX, StatCard, StatusBadge, TOOL_ICON, duration, timeAgo, useNow } from '../components/ui'

async function countWhere(col?: string, val?: string): Promise<number> {
  let q = supabase.from('results').select('id', { count: 'exact', head: true })
  if (col && val) q = q.eq(col, val)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

export function DashboardPage() {
  const { profile, isLead } = useAuth()
  const qc = useQueryClient()
  useEffect(() => { document.title = 'NAQB · Dashboard' }, [])

  const projects = useQuery({ queryKey: ['projects'], queryFn: async () => {
    const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data
  } })
  const jobs = useQuery({ queryKey: ['dash-jobs'], queryFn: async () => {
    const { data, error } = await supabase.from('scan_jobs').select('id,project_id,tool,target,status,created_at,started_at,finished_at').order('created_at', { ascending: false }).limit(200)
    if (error) throw error
    return data
  } })
  // Head-count queries: exact numbers, not capped by the API row limit.
  const counts = useQuery({ queryKey: ['dash-counts'], queryFn: async () => {
    const [total, ...rest] = await Promise.all([
      countWhere(),
      ...SEVERITIES.map((s) => countWhere('severity', s)),
      ...KINDS.map((k) => countWhere('kind', k)),
    ])
    return {
      total,
      severity: Object.fromEntries(SEVERITIES.map((s, i) => [s, rest[i]])) as Record<string, number>,
      kind: Object.fromEntries(KINDS.map((k, i) => [k, rest[SEVERITIES.length + i]])) as Record<string, number>,
    }
  } })

  useEffect(() => {
    const ch = supabase.channel('dash-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scan_jobs' }, () => {
        qc.invalidateQueries({ queryKey: ['dash-jobs'] }); qc.invalidateQueries({ queryKey: ['dash-counts'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])

  const all = jobs.data ?? []
  const active = all.filter((j) => j.status === 'running' || j.status === 'queued')
  const now = useNow(active.length > 0)
  const by = (s: string) => all.filter((j) => j.status === s).length
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? 'Project'
  const loading = counts.isLoading
  const firstName = (profile?.full_name || profile?.email || '').split(/[\s@]/)[0]

  const sevData = SEVERITIES.map((s) => ({ label: s, value: counts.data?.severity[s] ?? 0, color: SEV_HEX[s] }))
  const kindData = KINDS.map((k) => ({ label: k, value: counts.data?.kind[k] ?? 0, icon: KIND_ICON[k], color: k === 'vulnerability' ? '#fb923c' : '#e91b25' }))
  const toolCounts = Object.keys(TOOLS).map((t) => ({ label: TOOLS[t as ToolId].label, value: all.filter((j) => j.tool === t).length, icon: TOOL_ICON[t], color: '#60a5fa' })).filter((d) => d.value > 0)

  return (
    <div>
      <PageHeader title={`Welcome back${firstName ? ', ' + firstName : ''}`} subtitle={isLead ? 'Overview of every engagement.' : 'Overview of the engagements you are a member of.'} />

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Projects" value={projects.data?.length ?? 0} icon={FolderKanban} tone="brand" loading={projects.isLoading} hint={isLead ? 'All engagements' : 'Your engagements'} />
        <StatCard label="Active scans" value={active.length} icon={Activity} tone="blue" loading={jobs.isLoading} pulse={active.length > 0}
          hint={`${by('running')} running · ${by('queued')} queued`} />
        <StatCard label="Scan results" value={(counts.data?.total ?? 0).toLocaleString()} icon={Database} tone="sky" loading={loading} hint="Raw scanner output, not reviewed" />
        <StatCard label="Vulnerability-class" value={(counts.data?.kind.vulnerability ?? 0).toLocaleString()} icon={Bug} tone="amber" loading={loading} hint="Possible issues, not confirmed" />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card animate-fade-in">
          <div className="panel-head"><h2 className="card-title">Results by severity</h2></div>
          <div className="card-pad">{loading ? <div className="skeleton h-40 w-full" /> : <Donut data={sevData} centerLabel="results" />}</div>
        </div>
        <div className="card animate-fade-in">
          <div className="panel-head"><h2 className="card-title">Results by type</h2></div>
          <div className="card-pad">{loading ? <div className="skeleton h-40 w-full" /> : <BarList data={kindData.filter((d) => d.value > 0).length ? kindData : []} />}
            {!loading && kindData.every((d) => d.value === 0) && <p className="text-sm text-muted">No results yet.</p>}
          </div>
        </div>
        <div className="card animate-fade-in">
          <div className="panel-head"><h2 className="card-title">Scan activity</h2><span className="text-xs text-faint">last {all.length}</span></div>
          <div className="card-pad space-y-5">
            <div className="grid grid-cols-4 gap-2 text-center">
              {([['completed', CircleCheck, 'text-emerald-300'], ['failed', CircleX, 'text-rose-300'], ['running', Loader2, 'text-blue-300'], ['queued', Clock, 'text-muted']] as [string, LucideIcon, string][]).map(([s, Icon, c]) => (
                <div key={s} className="rounded-lg bg-raised px-1 py-2.5">
                  <Icon size={16} className={`mx-auto ${c} ${s === 'running' && by(s) ? 'animate-spin' : ''}`} aria-hidden />
                  <div className="mt-1 text-xl font-semibold tabular-nums">{by(s)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-faint">{s}</div>
                </div>
              ))}
            </div>
            {toolCounts.length > 0 ? <BarList data={toolCounts} /> : <p className="text-sm text-muted">No scans yet.</p>}
          </div>
        </div>
      </section>

      <section className="card mt-6 animate-fade-in">
        <div className="panel-head">
          <h2 className="card-title">Recent scans</h2>
          <Link to="/projects" className="text-xs font-medium text-muted transition hover:text-fg">All projects →</Link>
        </div>
        {jobs.isLoading ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 w-full" />)}</div>
          : all.length === 0 ? <EmptyState icon={ScanSearch} title="No scans yet" hint="Open a project and launch a scan. Results will show up here." action={<Link to="/projects" className="btn">Go to projects</Link>} />
          : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Status</th><th>Tool</th><th>Target</th><th>Project</th><th>Duration</th><th>Started</th></tr></thead>
                <tbody>
                  {all.slice(0, 8).map((j) => {
                    const Icon = TOOL_ICON[j.tool] ?? ScanSearch
                    return (
                      <tr key={j.id} className="hover:bg-hover/50">
                        <td><StatusBadge status={j.status} /></td>
                        <td><span className="inline-flex items-center gap-2 font-medium"><Icon size={15} className="text-muted" aria-hidden />{TOOLS[j.tool as ToolId]?.label ?? j.tool}</span></td>
                        <td className="mono max-w-[260px] truncate text-muted" title={j.target}>{j.target}</td>
                        <td><Link to={`/projects/${j.project_id}`} className="text-fg underline-offset-2 hover:text-naqb hover:underline">{projectName(j.project_id)}</Link></td>
                        <td className="tabular-nums text-muted">{duration(j.started_at, j.finished_at, now)}</td>
                        <td className="whitespace-nowrap text-muted">{timeAgo(j.created_at, now)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  )
}
