import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Role = 'team_lead' | 'pentester'
export interface Profile { id: string; email: string; full_name: string | null; role: Role }

interface AuthState { session: Session | null; profile: Profile | null; loading: boolean; isLead: boolean }
const Ctx = createContext<AuthState>({ session: null, profile: null, loading: true, isLead: false })
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) { setProfile(null); setLoading(false) } })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase.from('profiles').select('id,email,full_name,role').eq('id', session.user.id).single()
      .then(({ data }) => { setProfile(data as Profile | null); setLoading(false) })
  }, [session])

  return <Ctx.Provider value={{ session, profile, loading, isLead: profile?.role === 'team_lead' }}>{children}</Ctx.Provider>
}
