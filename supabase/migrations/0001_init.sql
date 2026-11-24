-- NAQB schema. Access rules live HERE (RLS), not in the UI.
-- New Supabase tables are not exposed to the API until granted, so every table has explicit GRANTs.

create type public.app_role as enum ('team_lead', 'pentester');
create type public.scope_kind as enum ('ip', 'cidr', 'domain', 'url');
create type public.job_status as enum ('queued', 'running', 'completed', 'failed');

-- ───────────── accounts ─────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'pentester',
  created_at timestamptz not null default now()
);

-- Every new account starts as Pentester, whatever the sign-up request says.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'pentester');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── helper predicates (security definer: avoid RLS recursion) ─────────────
create function public.is_team_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'team_lead')
$$;

-- ───────────── projects ─────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  client text,
  start_date date,
  end_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create function public.can_access_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_team_lead()
      or exists (select 1 from public.project_members where project_id = pid and user_id = auth.uid())
$$;

-- Scope = what scanners may touch. Only the Team Lead edits it.
create table public.scope_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.scope_kind not null,
  value text not null check (value ~ '^[A-Za-z0-9][A-Za-z0-9.:/_\-?=&%@\[\]]*$' and length(value) <= 2048),
  created_at timestamptz not null default now(),
  unique (project_id, kind, value)
);

-- Assets = the targets testers work with. Members may add them; scanning is still limited to scope.
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.scope_kind not null,
  value text not null check (value ~ '^[A-Za-z0-9][A-Za-z0-9.:/_\-?=&%@\[\]]*$' and length(value) <= 2048),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (project_id, kind, value)
);

-- ───────────── scan jobs, live output, results ─────────────
create table public.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  tool text not null check (tool in ('nmap','subfinder','gobuster','enum4linux-ng','ftp-scan','nuclei','nikto')),
  target text not null check (target ~ '^[A-Za-z0-9][A-Za-z0-9.:/_\-?=&%@\[\]]*$' and length(target) <= 2048),
  options jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  error text,
  raw_output text,                       -- the original tool output, kept next to the parsed results
  image text,                            -- image tag actually used
  cancel_requested boolean not null default false,
  launched_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index scan_jobs_queue_idx on public.scan_jobs (created_at) where status = 'queued';
create index scan_jobs_project_idx on public.scan_jobs (project_id, created_at desc);

create table public.job_output_chunks (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.scan_jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chunk text not null,
  created_at timestamptz not null default now()
);
create index job_output_job_idx on public.job_output_chunks (job_id, id);

create table public.results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid references public.scan_jobs(id) on delete cascade,  -- latest run that saw it
  tool text not null,
  kind text not null check (kind in ('host','port','service','subdomain','url','directory','share','vulnerability')),
  host text not null,
  port integer,
  value text not null,
  title text not null,
  severity text not null default 'info' check (severity in ('info','low','medium','high','critical','unknown')),
  data jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (project_id, dedupe_key)       -- re-runs update the row instead of repeating it
);
create index results_project_idx on public.results (project_id, last_seen desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects(id) on delete cascade,
  actor uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ───────────── job queue ─────────────
-- Atomically claim the oldest queued job. SKIP LOCKED lets several workers run safely.
create function public.claim_next_job() returns setof public.scan_jobs
language sql security definer set search_path = public as $$
  update public.scan_jobs j set status = 'running', started_at = now()
  where j.id = (
    select id from public.scan_jobs where status = 'queued' and not cancel_requested
    order by created_at for update skip locked limit 1
  )
  returning j.*
$$;
revoke all on function public.claim_next_job() from public, anon, authenticated;
grant execute on function public.claim_next_job() to service_role;

-- ───────────── Row Level Security ─────────────
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.scope_entries enable row level security;
alter table public.assets enable row level security;
alter table public.scan_jobs enable row level security;
alter table public.job_output_chunks enable row level security;
alter table public.results enable row level security;
alter table public.audit_log enable row level security;

-- profiles: you see yourself; the Team Lead sees everyone and is the only one who can change roles.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_team_lead());
create policy profiles_update_lead on public.profiles for update to authenticated
  using (public.is_team_lead()) with check (public.is_team_lead());

-- projects
create policy projects_select on public.projects for select to authenticated using (public.can_access_project(id));
create policy projects_insert on public.projects for insert to authenticated with check (public.is_team_lead());
create policy projects_update on public.projects for update to authenticated using (public.is_team_lead()) with check (public.is_team_lead());
create policy projects_delete on public.projects for delete to authenticated using (public.is_team_lead());

-- members: members can see who is on their project; only the Team Lead changes the list.
create policy members_select on public.project_members for select to authenticated using (public.can_access_project(project_id));
create policy members_insert on public.project_members for insert to authenticated with check (public.is_team_lead());
create policy members_delete on public.project_members for delete to authenticated using (public.is_team_lead());

-- scope: readable by members, writable by the Team Lead only
create policy scope_select on public.scope_entries for select to authenticated using (public.can_access_project(project_id));
create policy scope_write on public.scope_entries for all to authenticated using (public.is_team_lead()) with check (public.is_team_lead());

-- assets: members add/edit; delete is allowed to members too (they own the asset list)
create policy assets_select on public.assets for select to authenticated using (public.can_access_project(project_id));
create policy assets_insert on public.assets for insert to authenticated with check (public.can_access_project(project_id) and created_by = auth.uid());
create policy assets_update on public.assets for update to authenticated using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
create policy assets_delete on public.assets for delete to authenticated using (public.can_access_project(project_id));

-- scan jobs: members launch (as themselves, queued only); cancel own (lead: any); lead deletes.
create policy jobs_select on public.scan_jobs for select to authenticated using (public.can_access_project(project_id));
create policy jobs_insert on public.scan_jobs for insert to authenticated
  with check (public.can_access_project(project_id) and launched_by = auth.uid() and status = 'queued');
create policy jobs_cancel on public.scan_jobs for update to authenticated
  using (public.can_access_project(project_id) and (public.is_team_lead() or launched_by = auth.uid()))
  with check (public.can_access_project(project_id));
create policy jobs_delete on public.scan_jobs for delete to authenticated using (public.is_team_lead());

-- output + results: read-only for members; only the worker (service role) writes
create policy chunks_select on public.job_output_chunks for select to authenticated using (public.can_access_project(project_id));
create policy results_select on public.results for select to authenticated using (public.can_access_project(project_id));
create policy audit_select on public.audit_log for select to authenticated using (public.is_team_lead());

-- ───────────── grants (explicit; column-level where it matters) ─────────────
grant usage on schema public to authenticated, service_role;
grant select on public.profiles to authenticated;
grant update (role) on public.profiles to authenticated;           -- RLS limits this to the Team Lead
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.scope_entries to authenticated;
grant select, insert, update, delete on public.assets to authenticated;
grant select, delete on public.scan_jobs to authenticated;
grant insert (project_id, tool, target, options, launched_by) on public.scan_jobs to authenticated;
grant update (cancel_requested) on public.scan_jobs to authenticated;  -- the only column a user may change
grant select on public.job_output_chunks, public.results, public.audit_log to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ───────────── Realtime: push new output chunks and job status to the browser ─────────────
alter publication supabase_realtime add table public.job_output_chunks, public.scan_jobs;
