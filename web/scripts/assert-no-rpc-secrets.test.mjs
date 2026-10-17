import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import test from 'node:test'

function scan(contents) {
  const root = mkdtempSync(path.join(tmpdir(), 'everdraw-release-artifact-'))
  mkdirSync(path.join(root, 'assets'))
  writeFileSync(path.join(root, 'assets', 'app.js'), contents)
  return spawnSync(process.execPath, ['scripts/assert-no-rpc-secrets.mjs', root], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
}

test('release artifact scan accepts the public Monad RPC', () => {
  const result = scan('const rpc="https://rpc.monad.xyz"')
  assert.equal(result.status, 0, result.stderr)
})

test('release artifact scan rejects and redacts credential-bearing RPCs', () => {
  const secret = 'not-a-real-secret-value'
  const result = scan(`const rpc="https://monad-mainnet.g.alchemy.com/v2/${secret}"`)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /forbidden RPC material/)
  assert.equal(result.stderr.includes(secret), false)
})
