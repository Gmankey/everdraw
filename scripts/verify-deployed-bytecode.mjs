import { createHash } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'

const manifestPath = process.argv[2] || 'deployments/monad-mainnet.json'
const rpcUrl = process.env.MONAD_MAINNET_RPC_URL || 'https://rpc.monad.xyz'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const url = new URL(rpcUrl)
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 20000,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) reject(new Error(JSON.stringify(json.error)))
          else resolve(json.result)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('RPC timeout')))
    req.write(body)
    req.end()
  })
}

let failed = false

for (const c of manifest.contracts || []) {
  if (c.verification?.status !== 'verified') {
    console.log(`[bytecode] SKIP ${c.address} ${c.contractName}: verification status ${c.verification?.status || '(unset)'}`)
    continue
  }
  const code = await rpc('eth_getCode', [c.address, 'latest'])
  if (!code || code === '0x') {
    console.error(`[bytecode] Missing live code at ${c.address}`)
    failed = true
    continue
  }
  const hash = createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex')
  if (hash !== c.runtimeBytecodeSha256) {
    console.error(`[bytecode] Hash mismatch for ${c.address}: manifest=${c.runtimeBytecodeSha256} live=${hash}`)
    failed = true
  } else {
    console.log(`[bytecode] OK ${c.address} ${c.contractName}: ${hash}`)
  }
}

if (failed) process.exit(1)
