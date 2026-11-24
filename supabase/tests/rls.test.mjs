// Permission test: Team Lead, member, non-member. Run against a THROWAWAY Supabase project:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... SUPABASE_PUBLISHABLE_KEY=... node --test supabase/tests/rls.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, SUPABASE_PUBLISHABLE_KEY: pub } = process.env
const admin = createClient(url, secret, { auth: { persistSession: false } })
const stamp = Date.now()
const pw = 'Test-pass-12345'
const users = {}
let projectId

async function makeUser(label, role) {
  const email = `naqb-${label}-${stamp}@example.test`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true })
  assert.ifError(error)
  if (role === 'team_lead') await admin.from('profiles').update({ role }).eq('id', data.user.id)
  const client = createClient(url, pub, { auth: { persistSession: false } })
  assert.ifError((await client.auth.signInWithPassword({ email, password: pw })).error)
  users[label] = { id: data.user.id, client }
}

before(async () => {
  await makeUser('lead', 'team_lead'); await makeUser('member', 'pentester'); await makeUser('outsider', 'pentester')
  const { data } = await users.lead.client.from('projects').insert({ name: 'RLS test', created_by: users.lead.id }).select().single()
  projectId = data.id
  await users.lead.client.from('project_members').insert({ project_id: projectId, user_id: users.member.id })
  await users.lead.client.from('scope_entries').insert({ project_id: projectId, kind: 'ip', value: '10.10.0.5' })
})
after(async () => {
  await admin.from('projects').delete().eq('id', projectId)
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id)
})

test('new accounts start as pentester', async () => {
  const { data } = await admin.from('profiles').select('role').eq('id', users.outsider.id).single()
  assert.equal(data.role, 'pentester')
})
test('non-member sees nothing', async () => {
  for (const t of ['projects', 'scope_entries', 'assets', 'scan_jobs', 'results', 'job_output_chunks']) {
    const { data } = await users.outsider.client.from(t).select('*')
    assert.equal(data?.length ?? 0, 0, t)
  }
})
test('member sees the project; lead sees all', async () => {
  assert.equal((await users.member.client.from('projects').select('id').eq('id', projectId)).data.length, 1)
  assert.ok((await users.lead.client.from('projects').select('id').eq('id', projectId)).data.length === 1)
})
test('pentester cannot create/edit/delete projects', async () => {
  assert.ok((await users.member.client.from('projects').insert({ name: 'x' })).error)
  await users.member.client.from('projects').update({ name: 'hacked' }).eq('id', projectId)
  await users.member.client.from('projects').delete().eq('id', projectId)
  const { data } = await admin.from('projects').select('name').eq('id', projectId).single()
  assert.equal(data.name, 'RLS test')
})
test('pentester cannot change roles (own or others)', async () => {
  await users.member.client.from('profiles').update({ role: 'team_lead' }).eq('id', users.member.id)
  const { data } = await admin.from('profiles').select('role').eq('id', users.member.id).single()
  assert.equal(data.role, 'pentester')
})
test('pentester cannot edit scope or members', async () => {
  assert.ok((await users.member.client.from('scope_entries').insert({ project_id: projectId, kind: 'ip', value: '8.8.8.8' })).error)
  assert.ok((await users.member.client.from('project_members').insert({ project_id: projectId, user_id: users.outsider.id })).error)
})
test('member adds assets; outsider cannot', async () => {
  assert.ifError((await users.member.client.from('assets').insert({ project_id: projectId, kind: 'ip', value: '10.10.0.6', created_by: users.member.id })).error)
  assert.ok((await users.outsider.client.from('assets').insert({ project_id: projectId, kind: 'ip', value: '10.10.0.7', created_by: users.outsider.id })).error)
})
test('member launches own queued job; outsider cannot; status cannot be forged', async () => {
  const job = { project_id: projectId, tool: 'nmap', target: '10.10.0.5', launched_by: users.member.id }
  const ok = await users.member.client.from('scan_jobs').insert(job).select().single()
  assert.ifError(ok.error)
  assert.ok((await users.outsider.client.from('scan_jobs').insert({ ...job, launched_by: users.outsider.id })).error)
  assert.ok((await users.member.client.from('scan_jobs').insert({ ...job, status: 'completed' })).error, 'status column not grantable')
  // cancel own job; delete only by lead
  await users.member.client.from('scan_jobs').update({ cancel_requested: true }).eq('id', ok.data.id)
  await users.member.client.from('scan_jobs').delete().eq('id', ok.data.id)
  assert.equal((await admin.from('scan_jobs').select('id').eq('id', ok.data.id)).data.length, 1, 'member must not delete')
  await users.lead.client.from('scan_jobs').delete().eq('id', ok.data.id)
  assert.equal((await admin.from('scan_jobs').select('id').eq('id', ok.data.id)).data.length, 0)
})
test('users cannot write results or call the queue', async () => {
  assert.ok((await users.member.client.from('results').insert({ project_id: projectId, tool: 'nmap', kind: 'host', host: 'x', value: 'x', title: 'x', dedupe_key: 'x' })).error)
  assert.ok((await users.member.client.rpc('claim_next_job')).error)
})
