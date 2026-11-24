import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { FolderKanban, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Users, X, type LucideIcon } from 'lucide-react'
import { configured, supabase } from './lib/supabase'
import { useAuth } from './lib/auth'
import { Logo, MarkAndName } from './components/Logo'
import { Avatar, RolePill } from './components/ui'
import { CommandPalette } from './components/CommandPalette'
import { AuthPage } from './pages/AuthPage'
import { DashboardPage } from './pages/Dashboard'
import { ProjectsPage } from './pages/Projects'
import { ProjectPage } from './pages/Project'
import { UsersPage } from './pages/Users'

function ConfigRequired() {
  useEffect(() => { document.title = 'NAQB · Configuration required' }, [])
  return (
    <div className="mx-auto mt-24 max-w-md px-4 text-center animate-fade-in">
      <div className="mb-6 flex justify-center"><MarkAndName /></div>
      <div className="card card-pad">
        <h1 className="text-xl font-semibold">Configuration required</h1>
        <p className="mt-2 text-sm text-muted">
          Set <b className="text-fg">VITE_SUPABASE_URL</b> and <b className="text-fg">VITE_SUPABASE_PUBLISHABLE_KEY</b> in <b className="text-fg">.env</b>, then restart the app.
        </p>
      </div>
    </div>
  )
}

const readCollapsed = () => { try { return localStorage.getItem('naqb.sidebar') === 'collapsed' } catch { return false } }

function NavItem({ to, icon: Icon, label, collapsed, onClick }: { to: string; icon: LucideIcon; label: string; collapsed: boolean; onClick?: () => void }) {
  return (
    <NavLink to={to} onClick={onClick} title={collapsed ? label : undefined}
      className={({ isActive }) => `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-naqb/10 text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-naqb" aria-hidden />}
          <Icon size={18} className={isActive ? 'text-naqb' : ''} aria-hidden />
          {!collapsed && <span>{label}</span>}
        </>
      )}
    </NavLink>
  )
}

function Sidebar({ collapsed, onToggle, onNavigate, onSearch, mobile }: { collapsed: boolean; onToggle: () => void; onNavigate?: () => void; onSearch: () => void; mobile?: boolean }) {
  const { profile, isLead } = useAuth()
  const name = profile?.full_name || profile?.email || ''
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className={`flex h-16 items-center border-b border-line px-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        <MarkAndName collapsed={collapsed} />
        {mobile && <button className="icon-btn" onClick={onNavigate} aria-label="Close menu"><X size={18} /></button>}
      </div>
      <div className="px-3 pt-3">
        <button onClick={() => { onSearch(); onNavigate?.() }} title="Search (Ctrl+K)" aria-label="Search"
          className={`flex w-full items-center gap-2 rounded-lg border border-line-strong bg-bg px-3 py-2 text-sm text-faint transition hover:border-faint hover:text-muted ${collapsed ? 'justify-center' : ''}`}>
          <Search size={15} aria-hidden />{!collapsed && <><span className="flex-1 text-left">Search…</span><span className="kbd">Ctrl K</span></>}
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main">
        {!collapsed && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Workspace</p>}
        <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} onClick={onNavigate} />
        <NavItem to="/projects" icon={FolderKanban} label="Projects" collapsed={collapsed} onClick={onNavigate} />
        {isLead && (
          <>
            {!collapsed && <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-faint">Administration</p>}
            <NavItem to="/users" icon={Users} label="Users" collapsed={collapsed} onClick={onNavigate} />
          </>
        )}
      </nav>
      <div className="border-t border-line p-3">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-3 rounded-lg bg-raised p-2.5">
            <Avatar name={name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              <div className="mt-0.5"><RolePill role={profile?.role ?? 'pentester'} /></div>
            </div>
          </div>
        )}
        <div className={`flex ${collapsed ? 'flex-col items-center gap-1' : 'items-center justify-between'}`}>
          <button className="icon-btn" onClick={() => supabase.auth.signOut()} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          {!mobile && (
            <button className="icon-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Shell() {
  const { isLead } = useAuth()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((o) => !o) } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const { pathname } = useLocation()
  useEffect(() => { setDrawer(false) }, [pathname])
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('naqb.sidebar', c ? 'expanded' : 'collapsed') } catch { /* ignore */ } return !c })

  return (
    <div className="min-h-screen">
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      {/* Desktop sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 hidden border-r border-line transition-[width] duration-200 md:block ${collapsed ? 'w-[68px]' : 'w-60'}`}>
        <Sidebar collapsed={collapsed} onToggle={toggle} onSearch={() => setPalette(true)} />
      </aside>
      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line animate-slide-in"><Sidebar collapsed={false} mobile onToggle={() => {}} onSearch={() => setPalette(true)} onNavigate={() => setDrawer(false)} /></aside>
        </div>
      )}
      <div className={`transition-[padding] duration-200 ${collapsed ? 'md:pl-[68px]' : 'md:pl-60'}`}>
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur md:hidden">
          <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={20} /></button>
          <MarkAndName />
        </div>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/users" element={isLead ? <UsersPage /> : <Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export function App() {
  const { session, loading } = useAuth()
  useEffect(() => { document.title = 'NAQB' }, [])
  if (!configured) return <ConfigRequired />
  if (loading) return <div className="flex h-screen items-center justify-center"><Logo variant="mark" className="h-16 w-16 animate-pulse" /></div>
  if (!session) return <AuthPage />
  return <Shell />
}

