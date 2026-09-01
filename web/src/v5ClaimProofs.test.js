import assert from 'node:assert/strict'
import test from 'node:test'
import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers'
import { buildV5ClaimManyArgs, verifyV5ClaimManyArgs } from './v5ClaimProofs.js'

test('batches every claimable winner leaf into one claimMany payload', () => {
  const base = {
    claimable: true,
    distribution_id: '0x01',
    account: '0x02',
    token: '0x03',
    amount: '100',
    kind: 0,
    proof: ['0x04'],
  }
  const result = buildV5ClaimManyArgs([
    { ...base, leaf_index: 0 },
    { ...base, distribution_id: '0x05', leaf_index: 1, proof: ['0x06'] },
    { ...base, distribution_id: '0x07', leaf_index: 2, claimable: false },
  ])
  assert.equal(result.leaves.length, 2)
  assert.deepEqual(result.proofs, [['0x04'], ['0x06']])
})

test('browser binds a winner proof to release, wallet, finalized root, and claimed state', async () => {
  const abi = AbiCoder.defaultAbiCoder()
  const account = '0x0000000000000000000000000000000000000044'
  const token = '0x0000000000000000000000000000000000000055'
  const config = {
    chainId: 143,
    prizeVault: '0x0000000000000000000000000000000000000011',
    drawManager: '0x0000000000000000000000000000000000000022',
    claimManager: '0x0000000000000000000000000000000000000033',
  }
  const drawId = 9n
  const distributionId = keccak256(abi.encode(['address', 'uint256'], [config.drawManager, drawId]))
  const leafHash = keccak256(abi.encode(
    ['bytes32', 'uint256', 'uint256', 'address', 'bytes32', 'uint256', 'address', 'address', 'uint256', 'uint8'],
    [
      keccak256(toUtf8Bytes('everdraw-v5-claim-leaf/3')),
      3,
      config.chainId,
      config.claimManager,
      distributionId,
      0,
      account,
      token,
      100,
      0,
    ],
  ))
  const proofRow = {
    claimable: true,
    chain_id: config.chainId,
    vault_address: config.prizeVault,
    draw_manager_address: config.drawManager,
    claim_manager_address: config.claimManager,
    draw_id: Number(drawId),
    distribution_id: distributionId,
    leaf_index: 0,
    account,
    token,
    amount: '100',
    kind: 0,
    leaf_hash: leafHash,
    proof: [],
    root: leafHash,
  }
  const claimManager = {
    async distributions() {
      return {
        source: config.drawManager,
        sourceKey: '0x' + drawId.toString(16).padStart(64, '0'),
        root: leafHash,
        leafCount: 1n,
        registeredAt: 1n,
      }
    },
    async isClaimed() {
      return false
    },
  }

  const result = await verifyV5ClaimManyArgs({
    claimProofs: [proofRow],
    config,
    account,
    claimManager,
  })
  assert.equal(result.leaves.length, 1)
  assert.equal(result.leaves[0].amount, '100')

  await assert.rejects(
    verifyV5ClaimManyArgs({
      claimProofs: [{ ...proofRow, amount: '101' }],
      config,
      account,
      claimManager,
    }),
    /leaf does not match/,
  )
  await assert.rejects(
    verifyV5ClaimManyArgs({
      claimProofs: [{ ...proofRow, root: '0x' + 'ff'.repeat(32) }],
      config,
      account,
      claimManager,
    }),
    /published root/,
  )
})
