-- Adds the xss-probe tool (headless-browser DOM/reflected-XSS check) to the allowed tool list.
alter table public.scan_jobs drop constraint scan_jobs_tool_check;
alter table public.scan_jobs add constraint scan_jobs_tool_check
  check (tool = any (array['nmap', 'subfinder', 'gobuster', 'enum4linux-ng', 'ftp-scan', 'nuclei', 'nikto', 'xss-probe']));
