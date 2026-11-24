import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Boxes, CircleCheck, CircleX, Lock, Mail, ShieldCheck, User, UserCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'

type Mode = 'login' | 'register' | 'reset'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().optional(),
  full_name: z.string().optional(),
})
type Form = z.infer<typeof schema>

const TITLES: Record<Mode, [string, string]> = {
  login: ['Sign in', 'Welcome back. Enter your details to continue.'],
  register: ['Create account', 'New accounts start as Pentester.'],
  reset: ['Reset password', 'We will email you a reset link.'],
}

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) })
  useEffect(() => { document.title = `NAQB · ${TITLES[mode][0]}` }, [mode])

  async function onSubmit(v: Form) {
    setMsg(null)
    if (mode !== 'reset' && (!v.password || v.password.length < 8)) return setMsg({ ok: false, text: 'Password must be at least 8 characters.' })
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password! })
      if (error) setMsg({ ok: false, text: error.message })
    } else if (mode === 'register') {
      const { error } = await supabase.auth.signUp({ email: v.email, password: v.password!, options: { data: { full_name: v.full_name } } })
      setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Account created. Check your email if confirmation is required.' })
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: window.location.origin })
      setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'If that email exists, a reset link is on its way.' })
    }
  }

  const field = 'relative'
  const icon = 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint'
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface p-12 lg:flex">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-naqb/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-blue-500/5 blur-3xl" aria-hidden />
        <div className="relative"><Logo variant="full" className="h-40" /></div>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Run scanners. Collect results. Keep every engagement in scope.</h2>
          <ul className="space-y-4 text-sm text-muted">
            {([[ShieldCheck, 'Scope is checked by the worker before every scan.'], [Boxes, 'Each tool runs in a fresh, isolated container that is deleted afterwards.'], [UserCheck, 'Access is enforced per project by the database itself.']] as const).map(([I, t]) => (
              <li key={t} className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-naqb/10 text-naqb"><I size={16} aria-hidden /></span><span className="pt-1">{t}</span></li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-faint">Authorised testing only. Scan targets you have written permission to test.</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex justify-center lg:hidden"><Logo variant="full" className="h-32" /></div>
          <h1 className="text-2xl font-semibold tracking-tight">{TITLES[mode][0]}</h1>
          <p className="mb-6 mt-1 text-sm text-muted">{TITLES[mode][1]}</p>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            {mode === 'register' && (
              <div className={field}><User size={16} className={icon} aria-hidden /><input className="input pl-10" placeholder="Full name" aria-label="Full name" {...register('full_name')} /></div>
            )}
            <div>
              <div className={field}><Mail size={16} className={icon} aria-hidden /><input className="input pl-10" type="email" placeholder="Email" aria-label="Email" autoComplete="email" {...register('email')} /></div>
              {errors.email && <p className="mt-1.5 text-xs text-rose-300">{errors.email.message}</p>}
            </div>
            {mode !== 'reset' && (
              <div className={field}><Lock size={16} className={icon} aria-hidden /><input className="input pl-10" type="password" placeholder="Password" aria-label="Password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} {...register('password')} /></div>
            )}
            {msg && (
              <p role="alert" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${msg.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-900 bg-rose-950/40 text-rose-300'}`}>
                {msg.ok ? <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden /> : <CircleX size={16} className="mt-0.5 shrink-0" aria-hidden />}{msg.text}
              </p>
            )}
            <button className="btn w-full py-2.5" disabled={isSubmitting}>{isSubmitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}</button>
          </form>
          <div className="mt-6 flex justify-between text-sm">
            {mode !== 'login' ? <button className="text-muted transition hover:text-fg" onClick={() => { setMode('login'); setMsg(null) }}>Back to sign in</button> : <span />}
            {mode === 'login' && <button className="text-muted transition hover:text-fg" onClick={() => { setMode('reset'); setMsg(null) }}>Forgot password?</button>}
            {mode !== 'register' && <button className="font-medium text-naqb transition hover:text-naqb-hover" onClick={() => { setMode('register'); setMsg(null) }}>Create account</button>}
          </div>
        </div>
      </main>
    </div>
  )
}
