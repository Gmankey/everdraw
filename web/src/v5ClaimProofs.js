import {
  AbiCoder,
  getAddress,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
} from 'ethers'

const abi = AbiCoder.defaultAbiCoder()
const LEAF_DOMAIN = keccak256(toUtf8Bytes('everdraw-v5-claim-leaf/3'))
const LEAF_VERSION = 3n
const BYTES32 = /^0x[0-9a-fA-F]{64}$/

function bytes32(value, label) {
  const normalized = String(value || '').toLowerCase()
  if (!BYTES32.test(normalized)) throw new Error(`Invalid ${label}`)
  return normalized
}

function proofRoot(leafHash, proof) {
  let hash = bytes32(leafHash, 'claim leaf')
  for (const node of proof) {
    const sibling = bytes32(node, 'claim proof node')
    const [left, right] = hash < sibling ? [hash, sibling] : [sibling, hash]
    hash = keccak256(solidityPacked(['bytes32', 'bytes32'], [left, right])).toLowerCase()
  }
  return hash
}

function claimLeafHash({ chainId, claimManagerAddress, distributionId, leaf }) {
  return keccak256(abi.encode(
    ['bytes32', 'uint256', 'uint256', 'address', 'bytes32', 'uint256', 'address', 'address', 'uint256', 'uint8'],
    [
      LEAF_DOMAIN,
      LEAF_VERSION,
      chainId,
      claimManagerAddress,
      distributionId,
      leaf.leafIndex,
      leaf.account,
      leaf.token,
      leaf.amount,
      leaf.kind,
    ],
  )).toLowerCase()
}

export function buildV5ClaimManyArgs(claimProofs) {
  const pending = (Array.isArray(claimProofs) ? claimProofs : []).filter((proof) => proof?.claimable)
  return {
    leaves: pending.map((proof) => ({
      distributionId: proof.distribution_id,
      leafIndex: proof.leaf_index,
      account: proof.account,
      token: proof.token,
      amount: proof.amount,
      kind: proof.kind,
    })),
    proofs: pending.map((proof) => proof.proof),
  }
}

export async function verifyV5ClaimManyArgs({
  claimProofs,
  config,
  account,
  claimManager,
}) {
  const pending = (Array.isArray(claimProofs) ? claimProofs : []).filter((proof) => proof?.claimable)
  if (pending.length === 0) return { leaves: [], proofs: [] }
  const wallet = getAddress(account).toLowerCase()
  const managerAddress = getAddress(config.drawManager).toLowerCase()
  const claimManagerAddress = getAddress(config.claimManager).toLowerCase()
  const vaultAddress = getAddress(config.prizeVault).toLowerCase()
  const distributions = new Map()

  for (const proofRow of pending) {
    const drawId = BigInt(proofRow.draw_id)
    const leafIndex = BigInt(proofRow.leaf_index)
    const amount = BigInt(proofRow.amount)
    const kind = Number(proofRow.kind)
    if (Number(proofRow.chain_id) !== Number(config.chainId)) throw new Error('Claim proof chain does not match this release')
    if (getAddress(proofRow.vault_address).toLowerCase() !== vaultAddress) throw new Error('Claim proof vault does not match this release')
    if (getAddress(proofRow.draw_manager_address).toLowerCase() !== managerAddress) throw new Error('Claim proof DrawManager does not match this release')
    if (getAddress(proofRow.claim_manager_address).toLowerCase() !== claimManagerAddress) throw new Error('Claim proof ClaimManager does not match this release')
    if (getAddress(proofRow.account).toLowerCase() !== wallet) throw new Error('Claim proof belongs to a different wallet')
    if (kind !== 0) throw new Error('Claim proof is not a winner payout')

    const distributionId = keccak256(abi.encode(['address', 'uint256'], [managerAddress, drawId])).toLowerCase()
    if (bytes32(proofRow.distribution_id, 'distribution id') !== distributionId) {
      throw new Error('Claim proof distribution does not match its draw')
    }
    const leaf = {
      distributionId,
      leafIndex,
      account: wallet,
      token: getAddress(proofRow.token).toLowerCase(),
      amount,
      kind,
    }
    const expectedLeaf = claimLeafHash({
      chainId: BigInt(config.chainId),
      claimManagerAddress,
      distributionId,
      leaf,
    })
    if (bytes32(proofRow.leaf_hash, 'claim leaf hash') !== expectedLeaf) {
      throw new Error('Claim proof leaf does not match its payload')
    }
    const root = proofRoot(expectedLeaf, proofRow.proof)
    if (root !== bytes32(proofRow.root, 'claim root')) {
      throw new Error('Claim proof does not resolve to its published root')
    }

    let distribution = distributions.get(distributionId)
    if (!distribution) {
      distribution = await claimManager.distributions(distributionId)
      distributions.set(distributionId, distribution)
    }
    const expectedSourceKey = '0x' + drawId.toString(16).padStart(64, '0')
    if (getAddress(distribution.source).toLowerCase() !== managerAddress
      || bytes32(distribution.sourceKey, 'distribution source key') !== expectedSourceKey
      || bytes32(distribution.root, 'on-chain distribution root') !== root
      || leafIndex >= BigInt(distribution.leafCount)
      || BigInt(distribution.registeredAt) === 0n) {
      throw new Error('Claim proof does not match the finalized on-chain distribution')
    }
    if (await claimManager.isClaimed(distributionId, leafIndex)) {
      throw new Error('Prize was already claimed')
    }
  }

  return buildV5ClaimManyArgs(pending)
}
