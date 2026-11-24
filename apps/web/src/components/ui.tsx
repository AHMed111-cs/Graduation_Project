import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, AlertTriangle, Bug, ChevronRight, CircleCheck, CircleX, Clock, Cog, FolderOpen, FolderSearch, Globe, HardDrive,
  HelpCircle, Info, Link2, Loader2, MousePointerClick, Network, Plug, Radar, ScanSearch, Server, Share2, ShieldAlert, Zap, type LucideIcon,
} from 'lucide-react'

/* ───────────── Severity, status, kinds, tools ───────────── */
// Only a vulnerability-kind result ever carries one of these. 'unrated' means the tool itself has
// no severity concept (Nikto); 'unknown' means the tool reported a severity string we don't recognise.
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'unrated'] as const
export const SEV_HEX: Record<string, string> = { critical: '#f87171', high: '#fb923c', medium: '#facc15', low: '#2dd4bf', info: '#38bdf8', unknown: '#8f99ae', unrated: '#8f99ae' }
const SEV_ICON: Record<string, LucideIcon> = { critical: ShieldAlert, high: AlertTriangle, medium: AlertCircle, low: Info, info: Info, unrated: HelpCircle, unknown: HelpCircle }

/**
 * Always icon + text label: colour is never the only signal.
 * A host, port, subdomain, URL, directory or share has no severity at all (it's an observation, not
 * a finding) — `severity` is null for those, and this renders a plain dash instead of a badge.
 */
export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <span className="text-faint" aria-label="Not applicable">—</span>
  const s = SEVERITIES.includes(severity as (typeof SEVERITIES)[number]) ? severity : 'unknown'
  const Icon = SEV_ICON[s] ?? Info
  return <span className={`badge sev-${s}`}><Icon size={12} aria-hidden />{severity}</span>
}

const STATUS: Record<string, { cls: string; icon: LucideIcon; spin?: boolean }> = {
  queued: { cls: 'border-line-strong bg-raised text-muted', icon: Clock },
  running: { cls: 'border-blue-500/30 bg-blue-500/10 text-blue-300', icon: Loader2, spin: true },
  completed: { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', icon: CircleCheck },
  failed: { cls: 'border-rose-800 bg-rose-950/60 text-rose-300', icon: CircleX },
}
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.queued
  return <span className={`badge ${s.cls}`}><s.icon size={12} className={s.spin ? 'animate-spin' : ''} aria-hidden />{status}</span>
}

export const KINDS = ['host', 'port', 'service', 'subdomain', 'url', 'directory', 'share', 'vulnerability'] as const
export const KIND_ICON: Record<string, LucideIcon> = {
  host: Server, port: Plug, service: Cog, subdomain: Globe, url: Link2, directory: FolderOpen, share: Share2, vulnerability: Bug,
}
export function KindLabel({ kind }: { kind: string }) {
  const Icon = KIND_ICON[kind] ?? Info
  return <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize text-muted"><Icon size={14} aria-hidden />{kind}</span>
}

export const TOOL_ICON: Record<string, LucideIcon> = {
  nmap: Radar, subfinder: Globe, gobuster: FolderSearch, 'enum4linux-ng': Network, 'ftp-scan': HardDrive, nuclei: Zap, nikto: ScanSearch,
  'xss-probe': MousePointerClick,
}
export const TOOL_BLURB: Record<string, string> = {
  nmap: 'Ports, services, OS guess', subfinder: 'Passive subdomains', gobuster: 'Directories and files', 'enum4linux-ng': 'SMB users and shares',
  'ftp-scan': 'Anonymous login, banner', nuclei: 'Template-based checks', nikto: 'Web server issues',
  'xss-probe': 'Headless-browser XSS check',
}

/* ───────────── Layout pieces ───────────── */
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-6 animate-fade-in">
      {back && (
        <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-fg">
          <ChevronRight size={12} className="rotate-180" aria-hidden />{back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display truncate text-2xl font-bold">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

const TONE: Record<string, string> = {
  brand: 'bg-naqb/10 text-naqb', blue: 'bg-blue-500/10 text-blue-300', green: 'bg-emerald-500/10 text-emerald-300',
  amber: 'bg-amber-500/10 text-amber-300', sky: 'bg-sky-500/10 text-sky-300', neutral: 'bg-raised text-muted',
}
export function StatCard({ label, value, icon: Icon, tone = 'neutral', hint, loading, pulse }: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: keyof typeof TONE; hint?: ReactNode; loading?: boolean; pulse?: boolean
}) {
  return (
    <div className="card card-pad animate-fade-in transition hover:border-line-strong">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
        <span className={`relative flex h-9 w-9 items-center justify-center rounded-lg ${TONE[tone]}`}>
          <Icon size={18} aria-hidden />
          {pulse && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-blue-400 ring-2 ring-surface" />}
        </span>
      </div>
      {loading ? <div className="skeleton mt-3 h-8 w-20" /> : <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>}
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center animate-fade-in">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-raised text-faint"><Icon size={22} aria-hidden /></span>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300"><CircleX size={16} className="mt-0.5 shrink-0" aria-hidden />{(error as Error).message}</p>
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'
  return <span style={{ width: size, height: size, fontSize: size * 0.38 }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-hover to-line-strong font-semibold text-fg ring-1 ring-line-strong" aria-hidden>{initials}</span>
}

export function RolePill({ role }: { role: string }) {
  return role === 'team_lead'
    ? <span className="badge border-naqb/40 bg-naqb/10 text-naqb">Team Lead</span>
    : <span className="badge border-line-strong bg-raised text-muted">Pentester</span>
}

/* ───────────── Charts (no dependencies) ───────────── */
export function Donut({ data, size = 168, centerLabel, compact }: { data: { label: string; value: number; color: string }[]; size?: number; centerLabel?: string; compact?: boolean }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  const sw = compact ? 9 : 14
  const r = size / 2 - sw
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className={compact ? 'flex items-center gap-3' : 'flex flex-wrap items-center gap-6'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel ?? 'Total'}: ${total}`} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1d2330" strokeWidth={sw} />
        {total > 0 && data.filter((d) => d.value > 0).map((d) => {
          const len = (d.value / total) * c
          const el = (
            <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={sw}
              strokeDasharray={`${Math.max(len - 2, 0.5)} ${c - Math.max(len - 2, 0.5)}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .4s ease' }} />
          )
          offset += len
          return el
        })}
        <text x="50%" y={compact ? '54%' : '48%'} textAnchor="middle" className="fill-fg" style={{ fontSize: compact ? 18 : 26, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{total}</text>
        {!compact && <text x="50%" y="62%" textAnchor="middle" className="fill-muted" style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>{centerLabel ?? 'total'}</text>}
      </svg>
      <ul className={compact ? 'min-w-0 flex-1 space-y-1 text-xs' : 'min-w-[8rem] flex-1 space-y-2 text-sm'}>
        {data.map((d) => (
          <li key={d.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 capitalize text-muted"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} aria-hidden />{d.label}</span>
            <span className="tabular-nums font-medium">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function BarList({ data }: { data: { label: string; value: number; color?: string; icon?: LucideIcon }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 capitalize text-muted">{d.icon && <d.icon size={14} aria-hidden />}{d.label}</span>
            <span className="tabular-nums font-medium">{d.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? '#e91b25' }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ───────────── helpers ───────────── */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}
export function duration(start: string | null | undefined, end: string | null | undefined, now = Date.now()): string {
  if (!start) return '–'
  const s = Math.max(0, Math.round(((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
/** Re-renders every second while `active`, so running durations tick. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** Thin segmented bar: share of results per severity, like a report-completeness strip. */
export function SegBar({ data, label }: { data: { label: string; value: number; color: string }[]; label: string }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  const summary = data.filter((d) => d.value > 0).map((d) => `${d.value} ${d.label}`).join(', ') || 'no results'
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2" role="img" aria-label={`${label}: ${summary}`}>
      <span className="font-mono text-[11px] text-muted whitespace-nowrap">{label} <span className="text-fg tabular-nums">{total}</span></span>
      <div className="flex h-2.5 flex-1 gap-[3px] overflow-hidden rounded-full">
        {total === 0 ? <div className="h-full w-full rounded-full bg-raised" /> : data.filter((d) => d.value > 0).map((d) => (
          <div key={d.label} title={`${d.label}: ${d.value}`} className="h-full rounded-[3px] transition-[flex-grow] duration-500" style={{ flexGrow: d.value, flexBasis: 0, minWidth: 6, background: d.color }} />
        ))}
      </div>
    </div>
  )
}
