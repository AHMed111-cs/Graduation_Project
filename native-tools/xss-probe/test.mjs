// Real, end-to-end tests: launches a real browser against the real lab target (no mocks — the
// whole point of this tool is that it exercises an actual browser). Requires the lab to be running
// with Juice Shop's loopback port published (see lab/docker-compose.yml):
//   docker compose -f lab/docker-compose.yml up -d
//   npm test
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { probe, candidateParams, buildUrl, findChrome } from './detect.mjs'

const TARGET = process.env.NAQB_TEST_TARGET ?? 'http://127.0.0.1:3001'
const chromePath = findChrome()

before(async () => {
  const res = await fetch(TARGET).catch(() => null)
  assert.ok(res?.ok, `Lab target not reachable at ${TARGET}. Run: docker compose -f lab/docker-compose.yml up -d`)
})

test('candidateParams: reads an existing query param', () => {
  assert.deepEqual(candidateParams('http://x/#/search?q=foo'), [{ location: 'hash', key: 'q' }])
  assert.deepEqual(candidateParams('http://x/?a=1&b=2'), [{ location: 'search', key: 'a' }, { location: 'search', key: 'b' }])
})
test('candidateParams: falls back to a guess when there is no param at all', () => {
  assert.deepEqual(candidateParams('http://x/'), [{ location: 'search-guess', key: 'q' }, { location: 'hash-guess', key: 'q' }])
})
test('buildUrl: substitutes into the hash query string without disturbing the route', () => {
  const url = buildUrl('http://x/#/search?q=old', { location: 'hash', key: 'q' }, '<x>')
  assert.equal(url, 'http://x/#/search?q=%3Cx%3E')
})

test('finds the real, known DOM XSS on the lab target (Juice Shop search)', async () => {
  const result = await probe(`${TARGET}/#/search?q=test`, { chromePath })
  assert.equal(result.tested, 4)
  assert.equal(result.inconclusive.length, 0, 'no test should be inconclusive on a healthy native run')
  assert.equal(result.findings.length, 2, 'exactly the 2 payloads known to fire on this target should fire')
  const names = result.findings.map((f) => f.name).sort()
  assert.deepEqual(names, ['iframe javascript: URI', 'img onerror'])
  for (const f of result.findings) {
    assert.equal(f.evidence.type, 'alert')
    assert.ok(f.payload.includes(f.evidence.message), 'the fired marker must be the one THIS test injected')
    assert.ok(f.param, 'must say which parameter')
    assert.ok(f.url.startsWith(TARGET), 'must say exactly which URL triggered it')
  }
})

test('reports zero findings on a clean endpoint, not a crash or a false positive', async () => {
  const result = await probe(`${TARGET}/#/track-result?id=test`, { chromePath })
  assert.equal(result.tested, 4)
  assert.equal(result.inconclusive.length, 0)
  assert.equal(result.findings.length, 0)
})

test('reliability: 5 consecutive runs against the vulnerable target all agree', async () => {
  const outcomes = []
  for (let i = 0; i < 5; i++) {
    const result = await probe(`${TARGET}/#/search?q=test`, { chromePath })
    outcomes.push({ findings: result.findings.length, inconclusive: result.inconclusive.length })
  }
  for (const o of outcomes) assert.deepEqual(o, { findings: 2, inconclusive: 0 })
})

test('each finding carries a unique marker per run (no cross-test contamination)', async () => {
  const result = await probe(`${TARGET}/#/search?q=test`, { chromePath })
  const markers = result.findings.map((f) => f.evidence.message)
  assert.equal(new Set(markers).size, markers.length, 'every finding must have its own marker')
})
