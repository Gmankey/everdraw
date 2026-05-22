import fs from 'node:fs'

const manifestPath = process.argv[2] || 'deployments/monad-mainnet.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

let failed = false

function requireFile(label, file) {
  if (!file || !fs.existsSync(file)) {
    console.error(`[manifest] Missing ${label}: ${file || '(unset)'}`)
    failed = true
  }
}

for (const c of manifest.contracts || []) {
  const prefix = `${c.role || c.contractName} ${c.address || ''}`.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(c.address || '')) {
    console.error(`[manifest] Bad address for ${prefix}`)
    failed = true
  }
  requireFile(`${prefix} source`, c.source)
  requireFile(`${prefix} ABI`, c.abi)

  if (c.status === 'active') {
    if (c.verification?.status !== 'verified') {
      console.error(`[manifest] Active contract is not bytecode-verified: ${prefix}`)
      failed = true
    }
    if (!c.runtimeBytecodeSha256) {
      console.error(`[manifest] Active contract missing runtimeBytecodeSha256: ${prefix}`)
      failed = true
    }
    if (!c.constructorArgs || Object.keys(c.constructorArgs).length === 0) {
      console.error(`[manifest] Active contract missing constructorArgs: ${prefix}`)
      failed = true
    }
    if (!c.compiler?.version || !c.compiler?.evmVersion) {
      console.error(`[manifest] Active contract missing compiler version/settings: ${prefix}`)
      failed = true
    }
  }

  if (c.verification?.evidence) requireFile(`${prefix} evidence`, c.verification.evidence)
}

if (failed) process.exit(1)
console.log(`[manifest] OK: ${manifestPath}`)
