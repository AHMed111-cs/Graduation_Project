import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronRight, FolderKanban, Plus, Search, Building2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { EmptyState, ErrorNote, PageHeader } from '../components/ui'

type Phase = { label: string; cls: string }
function phaseOf(start: string | null, end: string | null): Phase {
  const today = new Date().toISOString().slice(0, 10)
  if (start && today < start) return { label: 'Upcoming', cls: 'border-blue-500/30 bg-blue-500/10 text-blue-300' }
  if (end && today > end) return { label: 'Ended', cls: 'border-line-strong bg-raised text-muted' }
  return { label: 'Active', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' }
}
const fmt = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '…')

export function ProjectsPage() {
  const { isLead, session } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [dateErr, setDateErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => { document.title = 'NAQB · Projects' }, [])

  const q = useQuery({ queryKey: ['projects'], queryFn: async () => {
    const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data
  } })
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('projects').insert({ name, client: client || null, start_date: start || null, end_date: end || null, created_by: session!.user.id })
      if (error) throw error
    },
    onSuccess: () => { setName(''); setClient(''); setStart(''); setEnd(''); setShowForm(false); qc.invalidateQueries({ queryKey: ['projects'] }) },
  })

  const list = (q.data ?? []).filter((p) => !filter || `${p.name} ${p.client ?? ''}`.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div>
      <PageHeader title="Projects" subtitle="One project per engagement. Access, scope and results are all per project."
        actions={isLead && !showForm ? <button className="btn" onClick={() => setShowForm(true)}><Plus size={16} aria-hidden />New project</button> : undefined} />

      {isLead && showForm && (
        <form className="card card-pad mb-6 animate-pop" onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          if (start && end && end < start) { setDateErr('End date must be on or after the start date.'); return }
          setDateErr(null); create.mutate()
        }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="card-title">New engagement</h2>
            <button type="button" className="icon-btn" onClick={() => setShowForm(false)} aria-label="Close form"><X size={16} /></button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="p-name">Engagement name</label><input id="p-name" className="input" placeholder="e.g. Acme external test" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
            <div><label className="label" htmlFor="p-client">Client</label><input id="p-client" className="input" placeholder="Client name" value={client} onChange={(e) => setClient(e.target.value)} /></div>
            <div><label className="label" htmlFor="p-start">Start date</label><input id="p-start" className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><label className="label" htmlFor="p-end">End date</label><input id="p-end" className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div className="mt-4 space-y-3">
            {dateErr && <ErrorNote error={new Error(dateErr)} />}
            {create.error && <ErrorNote error={create.error} />}
            <div className="flex gap-2">
              <button className="btn" disabled={create.isPending || !name.trim()}>{create.isPending ? 'Creating…' : 'Create project'}</button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </form>
      )}

      {(q.data?.length ?? 0) > 4 && (
        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input className="input pl-9" placeholder="Filter projects…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter projects" />
        </div>
      )}

      {q.isLoading && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-36" />)}</div>}
      <ErrorNote error={q.error} />
      {!q.isLoading && !q.error && (q.data?.length ?? 0) === 0 && (
        <div className="card"><EmptyState icon={FolderKanban} title={isLead ? 'No projects yet' : 'No projects assigned to you'}
          hint={isLead ? 'Create the first engagement to define its scope and start scanning.' : 'A Team Lead has to add you as a member of a project before you can see it.'} /></div>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => {
          const ph = phaseOf(p.start_date, p.end_date)
          return (
            <li key={p.id} className="animate-fade-in">
              <Link to={`/projects/${p.id}`} className="card group block h-full p-5 transition hover:-translate-y-0.5 hover:border-line-strong hover:bg-raised">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-naqb/10 text-sm font-bold text-naqb">{p.name.slice(0, 2).toUpperCase()}</span>
                  <span className={`badge ${ph.cls}`}>{ph.label}</span>
                </div>
                <h3 className="mt-4 truncate text-base font-semibold">{p.name}</h3>
                <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted"><Building2 size={13} aria-hidden />{p.client ?? 'No client'}</p>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                  <span className="flex items-center gap-1.5"><CalendarDays size={13} aria-hidden />{p.start_date ? `${fmt(p.start_date)} → ${fmt(p.end_date)}` : 'No dates set'}</span>
                  <ChevronRight size={15} className="transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
