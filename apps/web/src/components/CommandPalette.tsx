import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CornerDownLeft, FolderKanban, LayoutDashboard, Search, Users, type LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

interface Item { id: string; label: string; hint: string; to: string; icon: LucideIcon }

/** Ctrl/⌘+K quick switcher: jump to a page or a project. Navigation only. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isLead } = useAuth()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const projects = useQuery({ queryKey: ['projects'], enabled: open, queryFn: async () => {
    const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data
  } })

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0) } }, [open])

  const items = useMemo<Item[]>(() => {
    const pages: Item[] = [
      { id: 'dash', label: 'Dashboard', hint: 'Page', to: '/dashboard', icon: LayoutDashboard },
      { id: 'proj', label: 'Projects', hint: 'Page', to: '/projects', icon: FolderKanban },
      ...(isLead ? [{ id: 'users', label: 'Users', hint: 'Page', to: '/users', icon: Users }] : []),
    ]
    const ps: Item[] = (projects.data ?? []).map((p) => ({ id: p.id, label: p.name, hint: p.client ?? 'Project', to: `/projects/${p.id}`, icon: FolderKanban }))
    const all = [...pages, ...ps]
    const t = q.trim().toLowerCase()
    return (t ? all.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(t)) : all).slice(0, 8)
  }, [q, projects.data, isLead])

  useEffect(() => { setSel(0) }, [q])
  if (!open) return null
  const go = (i?: Item) => { if (i) { nav(i.to); onClose() } }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Quick switcher">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl animate-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="text-faint" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a page or project…" aria-label="Search"
            className="h-12 flex-1 bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter') go(items[sel])
            }} />
          <span className="kbd">Esc</span>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing found.</li>}
          {items.map((i, idx) => (
            <li key={i.id} role="option" aria-selected={idx === sel}>
              <button className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${idx === sel ? 'bg-hover text-fg' : 'text-muted'}`}
                onMouseEnter={() => setSel(idx)} onClick={() => go(i)}>
                <i.icon size={16} className={idx === sel ? 'text-naqb' : ''} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                <span className="text-xs text-faint">{i.hint}</span>
                {idx === sel && <CornerDownLeft size={13} className="text-faint" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
