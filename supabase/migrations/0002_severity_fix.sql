-- Severity belongs only to a vulnerability-kind result. A host, port, subdomain, URL, directory or
-- share is an observation, not a finding, so it must be NULL, not 'info'. Nikto has no severity
-- concept of its own, so its findings are 'unrated', not 'info' either.

alter table public.results alter column severity drop not null;
alter table public.results alter column severity drop default;
alter table public.results drop constraint if exists results_severity_check;
alter table public.results add constraint results_severity_check
  check (severity is null or severity in ('critical', 'high', 'medium', 'low', 'info', 'unknown', 'unrated'));

-- A non-vulnerability result was previously stored with the old hardcoded 'info'; clear it.
update public.results set severity = null where kind <> 'vulnerability' and severity = 'info';
-- A Nikto finding was previously stored as 'info' because Nikto itself rates nothing; relabel it.
update public.results set severity = 'unrated' where tool = 'nikto' and kind = 'vulnerability' and severity = 'info';
