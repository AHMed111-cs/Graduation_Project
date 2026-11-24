# Parser fixtures

PLACEHOLDER samples written by hand in each tool's documented output format.
Brief check #3 requires REAL saved output. Run each tool against the lab (Juice Shop etc.),
save stdout here under the same file name, and re-run `npm test`.
nikto.json and ftpscan.json are the highest risk: Nikto 2.6.0 changed its JSON in 2026,
and FTP-Scan's JSON is our own patched schema.
