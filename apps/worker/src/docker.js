import { spawn } from 'node:child_process'

/**
 * Shared streaming/timeout/cancel/output-cap logic for both execution modes below. `kill()` is the
 * only genuinely different part between them (docker rm -f vs. killing the process tree directly).
 * Resolves { stdout, stderr, exitCode, timedOut, truncated, cancelled }.
 */
function runSpawned(command, spawnArgs, { limits, onChunk, shouldCancel, kill, detached = false }) {
  return new Promise((resolve) => {
    const child = spawn(command, spawnArgs, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached })

    let stdout = ''
    let stderr = ''
    let bytes = 0
    let timedOut = false
    let truncated = false
    let cancelled = false

    const timer = setTimeout(() => { timedOut = true; kill(child) }, limits.timeoutSec * 1000)
    const poll = setInterval(async () => {
      try { if (await shouldCancel()) { cancelled = true; kill(child) } } catch { /* ignore */ }
    }, 3000)

    child.stdout.setEncoding('utf8').on('data', (d) => {
      if (truncated) return
      bytes += Buffer.byteLength(d)
      if (bytes > limits.maxOutputBytes) { truncated = true; kill(child); return }
      stdout += d
      onChunk(d)
    })
    child.stderr.setEncoding('utf8').on('data', (d) => {
      if (stderr.length < 64_000) stderr += d
      onChunk(d) // progress lines show up live too
    })
    const done = (exitCode) => {
      clearTimeout(timer); clearInterval(poll)
      kill(child) // belt and braces: guarantees nothing is left running
      resolve({ stdout, stderr, exitCode, timedOut, truncated, cancelled })
    }
    child.on('error', (e) => { stderr += String(e); done(-1) })
    child.on('close', (code) => done(code))
  })
}

/**
 * Run one tool in a throwaway container.
 * - args are passed as a LIST to spawn() with no shell, so a target can never become a command.
 * - --rm deletes the container afterwards; on timeout/cancel/cap we also `docker rm -f` it by name.
 */
export function runContainer({ name, image, args, limits, network, mounts = [], entrypoint, onChunk, shouldCancel }) {
  const dockerArgs = [
    'run', '--rm', '--name', name,
    '--memory', limits.memory, '--cpus', String(limits.cpus), '--pids-limit', '256',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--read-only', '--tmpfs', '/tmp:rw,size=64m', '-e', 'HOME=/tmp',
    '--network', network,
    ...mounts.flatMap((m) => ['-v', `${m.host}:${m.container}:ro`]),
    ...(entrypoint ? ['--entrypoint', entrypoint[0]] : []),
    image, ...(entrypoint ? entrypoint.slice(1) : []), ...args,
  ]
  const kill = () => spawn('docker', ['rm', '-f', name], { shell: false, stdio: 'ignore' })
  return runSpawned('docker', dockerArgs, { limits, onChunk, shouldCancel, kill })
}

/**
 * Run one tool as a plain process on the worker's own machine — no Docker, no isolation beyond the
 * timeout/output cap below. Only used for a tool that explicitly opts in (`execute: 'host'` in
 * tools.ts) because it cannot run inside the hardened container (see xss-probe's own doc comment
 * there). The SAME scope check every tool gets still runs before this is ever called.
 */
export function runHostProcess({ command, args, limits, onChunk, shouldCancel }) {
  // child.kill() alone only signals the immediate process. detect.mjs launches Chrome as a CHILD of
  // that process, so on a hard timeout/cancel (the one case where it doesn't get to run its own
  // `finally { browser.close() }`) a plain kill would orphan a running Chrome instance. Kill the
  // whole tree instead: taskkill /t on Windows, the process group on POSIX.
  const kill = (child) => {
    if (!child.pid) return
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: false, stdio: 'ignore' })
      else process.kill(-child.pid, 'SIGKILL')
    } catch { /* already gone */ }
  }
  return runSpawned(command, args, { limits, onChunk, shouldCancel, kill, detached: process.platform !== 'win32' })
}
