import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error(`[deploy-preflight] ${message}`)
  process.exitCode = 1
}

const requiredBranch = process.env.DEPLOY_BRANCH || 'staging'
const branch = git(['branch', '--show-current'])
const dirty = git(['status', '--porcelain'])

if (branch !== requiredBranch) {
  fail(`Refusing deploy from branch '${branch || '(detached)'}'; expected '${requiredBranch}'.`)
}

if (dirty) {
  fail('Refusing deploy with uncommitted changes. Commit exact source/artifacts before deploying.')
}

git(['fetch', 'origin', requiredBranch])
const head = git(['rev-parse', 'HEAD'])
const remote = git(['rev-parse', `origin/${requiredBranch}`])
if (head !== remote) {
  fail(`Refusing deploy because HEAD ${head} is not pushed/current with origin/${requiredBranch} ${remote}.`)
}

for (const file of ['deployments/monad-mainnet.json', 'src/TicketPrizePoolShmonV2.sol', 'abi/TicketPrizePoolShmonV2.json']) {
  if (!fs.existsSync(file)) fail(`Required production source-control file missing: ${file}`)
}

if (process.exitCode) process.exit(process.exitCode)
console.log('[deploy-preflight] OK')
