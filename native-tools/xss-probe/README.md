# NAQB XSS Probe (native)

A headless-browser XSS detector that **runs directly on the host — no Docker.**

## Why native

The first version of this tool ran in a Docker container, matching every other NAQB scanner. It
turned out unreliable on this machine, and the cause was root-caused with real evidence, not
guesses: instrumented logging plus Chrome's own internal stderr (`dumpio`) showed that **Chrome's
`crashpad` crash-handler cannot start at all under a `--read-only` container root filesystem.**
One payload (a dynamically-injected `<script>` tag) reliably triggered a renderer-level fault;
crashpad tried to handle it, failed itself (it couldn't open
`/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq`, not present in the container), and the
browser's DevTools connection was left in permanent limbo instead of cleanly reporting a crash —
which is why it hung rather than erroring.

Running natively removes the read-only root, the dropped capabilities and the cgroup limits that
were in conflict with Chrome's own crash-handling internals, rather than continuing to fight a
third-party browser's internals from inside a container. Proven with **20 consecutive identical
runs** (see below) plus a full automated test suite — zero failures, zero inconclusive results.

## What it does

Runs a **real** headless Chrome/Edge against the target and watches for a **real**
`alert()`/`confirm()`/`prompt()` call carrying a unique per-test marker. Detection does not use
Chrome's native dialog (that goes through a DevTools event that races with navigation) —
`alert`/`confirm`/`prompt` are overridden *inside the page*, before any page script runs, so there
is no native dialog and nothing to race on.

This is how it catches **DOM-based XSS**: the payload only ever appears in the DOM after
client-side JavaScript (Angular/React/Vue) inserts it — never in any HTTP response body — which a
classic HTTP-response-scanning active scanner (e.g. OWASP ZAP's reflected/persistent XSS rules)
cannot see at all. Confirmed directly against this project's own lab: ZAP's active scanner found
zero XSS on Juice Shop; this tool finds the same real, confirmed vulnerability every single run.

It tries 4 well-known payload shapes (`<iframe src="javascript:...">`, `<img onerror>`,
`"><script>`, `<svg onload>`) against every query parameter it can find — in the normal query
string, and inside a `#/path?a=b`-style single-page-app hash route (Angular/Vue apps often fake a
query string inside the URL fragment, e.g. Juice Shop's own search).

## Run it

```bash
npm install
# Lab must be running with Juice Shop's loopback port published:
#   docker compose -f ../../lab/docker-compose.yml up -d
node detect.mjs "http://127.0.0.1:3001/#/search?q=test"
# or write the full result to a file too:
node detect.mjs "http://127.0.0.1:3001/#/search?q=test" --json=result.json
```

Needs a Chrome or Edge install on the host. Auto-detected from common install paths; override with
`NAQB_CHROME_PATH=/path/to/chrome` if yours isn't found.

## Test it

```bash
npm test
```

Real end-to-end tests — no mocks. Launches a real browser against the real lab target and checks:
the known-vulnerable endpoint is found with correct evidence, a known-clean endpoint reports zero
findings (not a crash, not a false positive), 5 consecutive runs all agree, and every finding
carries its own unique marker (no cross-test contamination).

## Proof of reliability

20 consecutive runs against the lab target, same command, same result every time:

```
run 1:  findings=2 clean=2 inconclusive=0  time≈11.8s
run 2:  findings=2 clean=2 inconclusive=0  time≈11.8s
...
run 20: findings=2 clean=2 inconclusive=0  time≈11.9s
```

Every run found exactly the same two real findings (`iframe javascript: URI`, `img onerror`),
exactly the same two clean payloads (`script tag injection`, `svg onload`), zero inconclusive
results. The clean-target check (`#/track-result?id=test`) reported zero findings every time —
confirming the tool discriminates real firings rather than always reporting "vulnerable".

## Output shape

```json
{
  "target": "http://127.0.0.1:3001/#/search?q=test",
  "tested": 4,
  "findings": [
    {
      "name": "iframe javascript: URI",
      "location": "hash", "param": "q",
      "payload": "<iframe src=\"javascript:alert('naqb-xss-...')\">",
      "url": "http://127.0.0.1:3001/#/search?q=...",
      "evidence": { "type": "alert", "message": "naqb-xss-..." }
    }
  ],
  "inconclusive": []
}
```

`inconclusive` entries are tests that could not be completed (timeout) — never silently folded into
"clean". None occurred in any of the 20 proof runs or the automated test suite.

## Status

Standalone and fully working: detects a real, confirmed vulnerability with clear evidence, tested
and proven reliable. **Not yet wired into the NAQB job queue / UI** — this round was scoped to
getting a reliable detector built and proven. The output shape above is already close to NAQB's
common result format (`kind: 'vulnerability'`, `severity: 'high'` for a fired payload) if that
integration is wanted next: a thin "run this as a host subprocess instead of `docker run`" path in
the worker, plus a small parser consuming this JSON, is the natural next step.
