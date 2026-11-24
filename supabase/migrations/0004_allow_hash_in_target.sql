-- '#' (RFC 3986 fragment delimiter) is needed for single-page-app hash routes, e.g.
-- "http://host/#/search?q=...", which xss-probe targets directly. It poses no shell risk: targets
-- are passed as argv elements, never through a shell. Mirrors the matching change in scope.ts.
alter table public.scan_jobs drop constraint scan_jobs_target_check;
alter table public.scan_jobs add constraint scan_jobs_target_check
  check (target ~ '^[A-Za-z0-9][A-Za-z0-9.:/_\-?=&%@#\[\]]*$' and length(target) <= 2048);

alter table public.scope_entries drop constraint scope_entries_value_check;
alter table public.scope_entries add constraint scope_entries_value_check
  check (value ~ '^[A-Za-z0-9][A-Za-z0-9.:/_\-?=&%@#\[\]]*$' and length(value) <= 2048);

alter table public.assets drop constraint assets_value_check;
alter table public.assets add constraint assets_value_check
  check (value ~ '^[A-Za-z0-9][A-Za-z0-9.:/_\-?=&%@#\[\]]*$' and length(value) <= 2048);
