#!/usr/bin/env node
import { Contract, JsonRpcProvider, Wallet, getAddress, keccak256, toUtf8Bytes } from "ethers";

const TESTNET_CHAIN_ID = 10143n;
const SEEDED_STATUS = 2;
const PROPOSED_STATUS = 3;
const RPC_URL = process.env.RPC_URL || process.env.MONAD_TESTNET_RPC_URL;
const DRAW_MANAGER_ADDRESS = process.env.DRAW_MANAGER_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const drawId = BigInt(process.env.DRAW_ID || process.argv[2] || 0);

const ABI = [
  "function primaryProposer() view returns (address)",
  "function draws(uint256) view returns (uint64 periodStart,uint64 periodEnd,uint64 randomnessRequestId,bytes32 seed,uint256 totalTwab,uint256 totalPayout,uint32 winnerCount,uint32 rewardLegCount,bytes32 root,uint64 proposedAt,address proposer,uint8 status,uint256 grossYield,uint256 sponsorYield,uint256 feeAmount)",
  "function proposeRoot(uint256 drawId,bytes32 root,uint32 winnerCount,uint256 totalPayout)",
];

function required(name, value) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  required("RPC_URL/MONAD_TESTNET_RPC_URL", RPC_URL);
  required("DRAW_MANAGER_ADDRESS", DRAW_MANAGER_ADDRESS);
  required("PRIVATE_KEY", PRIVATE_KEY);
  if (drawId <= 0n) throw new Error("Set DRAW_ID to the seeded UAT draw");
  if (process.env.CONFIRM_BAD_ROOT_DRILL !== drawId.toString()) {
    throw new Error(`Set CONFIRM_BAD_ROOT_DRILL=${drawId} to confirm this deliberate UAT mismatch`);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  if (network.chainId !== TESTNET_CHAIN_ID) {
    throw new Error(`Refusing bad-root drill on chain ${network.chainId}; expected Monad testnet ${TESTNET_CHAIN_ID}`);
  }

  const signer = new Wallet(PRIVATE_KEY, provider);
  const manager = new Contract(getAddress(DRAW_MANAGER_ADDRESS), ABI, signer);
  const primaryProposer = getAddress(await manager.primaryProposer());
  if (getAddress(signer.address) !== primaryProposer) {
    throw new Error(`Signer ${signer.address} is not primary proposer ${primaryProposer}`);
  }

  const draw = await manager.draws(drawId);
  if (Number(draw.status) !== SEEDED_STATUS) {
    throw new Error(`Draw ${drawId} status is ${draw.status}; expected Seeded (${SEEDED_STATUS})`);
  }
  if (draw.totalPayout === 0n) throw new Error(`Draw ${drawId} has zero payout; use a paying draw for the veto drill`);

  const badRoot = keccak256(toUtf8Bytes(`everdraw-v5-deliberate-bad-root-drill:${drawId}`));
  await manager.proposeRoot.staticCall(drawId, badRoot, 1, draw.totalPayout);
  const tx = await manager.proposeRoot(drawId, badRoot, 1, draw.totalPayout);
  console.log(`bad-root proposal sent: ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`Bad-root proposal reverted: ${tx.hash}`);

  const proposed = await manager.draws(drawId);
  if (Number(proposed.status) !== PROPOSED_STATUS || proposed.root.toLowerCase() !== badRoot.toLowerCase()) {
    throw new Error(`Draw ${drawId} did not enter Proposed with the deliberate root`);
  }
  console.log(JSON.stringify({
    chainId: network.chainId.toString(),
    drawId: drawId.toString(),
    totalPayout: draw.totalPayout.toString(),
    badRoot,
    proposalTx: tx.hash,
  }, null, 2));
  console.log("KEEP THE KEEPER STOPPED. Dispatch the watcher, verify Telegram, then vetoRoot from the guardian Ledger.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
