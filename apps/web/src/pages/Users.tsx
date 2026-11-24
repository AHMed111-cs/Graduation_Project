import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth, type Profile } from '../lib/auth'
import { Avatar, EmptyState, ErrorNote, PageHeader, RolePill } from '../components/ui'

export function UsersPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  useEffect(() => { document.title = 'NAQB · Users' }, [])
  const q = useQuery({ queryKey: ['users'], queryFn: async () => {
    const { data, error } = await supabase.from('profiles').select('id,email,full_name,role').order('email')
    if (error) throw error
    return data as Profile[]
  } })
  const setRole = useMutation({
    mutationFn: async (v: { id: string; role: string }) => {
      const { error } = await supabase.from('profiles').update({ role: v.role }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  return (
    <div>
      <PageHeader title="Users" subtitle="Every new account starts as a Pentester. Only a Team Lead can promote someone." />
      <div className="mb-4"><ErrorNote error={setRole.error ?? q.error} /></div>
      <div className="card overflow-hidden animate-fade-in">
        {q.isLoading ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 w-full" />)}</div>
          : (q.data?.length ?? 0) === 0 ? <EmptyState icon={Users} title="No users" />
          : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>User</th><th>Current role</th><th>Change role</th></tr></thead>
                <tbody>
                  {q.data?.map((u) => (
                    <tr key={u.id} className="hover:bg-hover/50">
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.full_name || u.email} />
                          <div className="min-w-0"><p className="truncate font-medium">{u.full_name || u.email.split('@')[0]}</p><p className="truncate text-xs text-muted">{u.email}</p></div>
                        </div>
                      </td>
                      <td><RolePill role={u.role} /></td>
                      <td>
                        <select className="input w-44" value={u.role} disabled={u.id === profile?.id || setRole.isPending} aria-label={`Role for ${u.email}`}
                          title={u.id === profile?.id ? 'You cannot change your own role' : undefined}
                          onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })}>
                          <option value="pentester">Pentester</option><option value="team_lead">Team Lead</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}
