import fs from 'node:fs'
import path from 'node:path'

const checks = [
  {
    contract: 'TicketPrizePoolShmonV2',
    artifact: 'artifacts/src/TicketPrizePoolShmonV2.sol/TicketPrizePoolShmonV2.json',
    abi: 'abi/TicketPrizePoolShmonV2.json',
  },
  {
    contract: 'TicketPrizePoolShmonV3',
    artifact: 'artifacts/src/TicketPrizePoolShmonV3.sol/TicketPrizePoolShmonV3.json',
    abi: 'abi/TicketPrizePoolShmonV3.json',
  },
  {
    contract: 'TicketPrizePoolV4',
    artifact: 'artifacts/src/TicketPrizePoolV4.sol/TicketPrizePoolV4.json',
    abi: 'abi/TicketPrizePoolV4.json',
  },
  {
    contract: 'PythRandomnessOracle',
    artifact: 'artifacts/src/PythRandomnessOracle.sol/PythRandomnessOracle.json',
    abi: 'abi/PythRandomnessOracle.json',
  },
]

let failed = false

for (const check of checks) {
  if (!fs.existsSync(check.artifact) && !fs.existsSync(check.abi)) continue
  if (!fs.existsSync(check.artifact)) {
    console.error(`[abi] Missing artifact for ${check.contract}: ${check.artifact}. Run npm run build.`)
    failed = true
    continue
  }
  if (!fs.existsSync(check.abi)) {
    console.error(`[abi] Missing ABI file for ${check.contract}: ${check.abi}.`)
    failed = true
    continue
  }

  const artifact = JSON.parse(fs.readFileSync(check.artifact, 'utf8'))
  const abi = JSON.parse(fs.readFileSync(check.abi, 'utf8'))
  const expected = JSON.stringify(artifact.abi, null, 2) + '\n'
  const actual = JSON.stringify(abi, null, 2) + '\n'
  if (expected !== actual) {
    console.error(`[abi] Stale ABI for ${check.contract}: ${check.abi}. Regenerate from ${path.dirname(check.artifact)}.`)
    failed = true
  } else {
    console.log(`[abi] Fresh: ${check.abi}`)
  }
}

if (failed) process.exit(1)
