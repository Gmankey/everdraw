import { Contract, Interface, getAddress } from "ethers";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MANAGER_ABI = [
  "function vault() view returns (address)",
  "function twabController() view returns (address)",
  "function payoutToken() view returns (address)",
  "function draws(uint256) view returns (uint64 periodStart,uint64 periodEnd,uint64 randomnessRequestId,bytes32 seed,uint256 totalTwab,uint256 totalPayout,uint32 winnerCount,uint32 rewardLegCount,bytes32 root,uint64 proposedAt,address proposer,uint8 status,uint256 grossYield,uint256 sponsorYield,uint256 feeAmount)",
  "function drawRewardLegCount(uint256) view returns (uint256)",
  "function drawRewardLegAt(uint256,uint256) view returns (address token,uint256 amount)",
  "function drawFeeRecipientCount(uint256) view returns (uint256)",
  "function drawFeeRecipientAt(uint256,uint256) view returns (address account,uint16 bps)",
  "event SeedReceived(uint256 indexed drawId,uint64 indexed requestId,bytes32 seed)",
];
const VAULT_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 amount)",
];
const TWAB_ABI = [
  "function getTwabBetween(address vault,address account,uint256 startTime,uint256 endTime) view returns (uint256)",
  "error InsufficientHistory(uint32 requestedTimestamp,uint32 oldestTimestamp)",
];
const transferInterface = new Interface(VAULT_ABI);
const managerInterface = new Interface(MANAGER_ABI);
const twabInterface = new Interface(TWAB_ABI);
const TRANSFER_TOPIC = transferInterface.getEvent("Transfer").topicHash.toLowerCase();
const SEED_TOPIC = managerInterface.getEvent("SeedReceived").topicHash.toLowerCase();
const INSUFFICIENT_HISTORY_SELECTOR = twabInterface.getError("InsufficientHistory").selector.toLowerCase();

function sortLogs(logs) {
  return [...logs].sort((a, b) =>
    a.blockNumber !== b.blockNumber
      ? a.blockNumber - b.blockNumber
      : (a.logIndex ?? a.index ?? 0) - (b.logIndex ?? b.index ?? 0));
}

function addNonzero(accounts, account) {
  const normalized = getAddress(account);
  if (normalized !== ZERO_ADDRESS) accounts.add(normalized);
}

export function ingestWatcherReconstructionLogs({
  logs,
  vaultAddress,
  drawManagerAddress,
  initialAccounts = [],
  initialSeedBlocks = {},
}) {
  const vault = getAddress(vaultAddress);
  const manager = getAddress(drawManagerAddress);
  const accounts = new Set(initialAccounts.map((account) => getAddress(account)));
  const seedBlocks = { ...initialSeedBlocks };

  for (const log of sortLogs(logs)) {
    const address = getAddress(log.address);
    const topic0 = log.topics[0]?.toLowerCase();
    if (address === vault && topic0 === TRANSFER_TOPIC) {
      const parsed = transferInterface.parseLog(log);
      addNonzero(accounts, parsed.args.from);
      addNonzero(accounts, parsed.args.to);
    } else if (address === manager && topic0 === SEED_TOPIC) {
      const parsed = managerInterface.parseLog(log);
      seedBlocks[parsed.args.drawId.toString()] = Number(log.blockNumber);
    }
  }

  return {
    accounts: [...accounts].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    seedBlocks,
  };
}

function revertData(error) {
  return error?.data ?? error?.error?.data ?? error?.info?.error?.data ?? "";
}

export function isInsufficientHistoryError(error) {
  return String(revertData(error)).slice(0, 10).toLowerCase() === INSUFFICIENT_HISTORY_SELECTOR;
}

export async function buildWatcherDrawInput({
  provider,
  drawManagerAddress,
  drawId,
  seedBlock,
  participantAccounts,
}) {
  const manager = new Contract(drawManagerAddress, MANAGER_ABI, provider);
  const draw = await manager.draws(drawId);
  const status = Number(draw.status);
  if (![2, 3, 4].includes(status)) {
    throw new Error(`Draw ${drawId} status ${status}; expected Seeded/Proposed/Finalized`);
  }
  if (draw.seed === `0x${"00".repeat(32)}`) throw new Error(`Draw ${drawId} has no seed`);

  const vaultAddress = getAddress(await manager.vault());
  const twabAddress = getAddress(await manager.twabController());
  const twab = new Contract(twabAddress, TWAB_ABI, provider);
  const accounts = [];
  for (const account of participantAccounts) {
    let value;
    try {
      value = await twab.getTwabBetween(
        vaultAddress,
        account,
        draw.periodStart,
        draw.periodEnd,
        { blockTag: seedBlock },
      );
    } catch (error) {
      if (!isInsufficientHistoryError(error)) throw error;
      value = 0n;
    }
    if (value > 0n) accounts.push({ address: getAddress(account), twab: value.toString() });
  }

  const summedTwab = accounts.reduce((sum, account) => sum + BigInt(account.twab), 0n);
  if (summedTwab !== draw.totalTwab) {
    throw new Error(`Watcher TWAB mismatch for draw ${drawId}: account sum ${summedTwab} != draw total ${draw.totalTwab}`);
  }

  const feeRecipients = [];
  const feeRecipientCount = Number(await manager.drawFeeRecipientCount(drawId));
  let feeBps = 0n;
  for (let i = 0; i < feeRecipientCount; i++) {
    const [account, bps] = await manager.drawFeeRecipientAt(drawId, i);
    feeRecipients.push({ account: getAddress(account), bps: bps.toString() });
    feeBps += BigInt(bps);
  }

  const payoutToken = getAddress(await manager.payoutToken());
  const prizeLegs = [{
    token: payoutToken,
    amount: draw.totalPayout.toString(),
    feeAmount: draw.feeAmount.toString(),
  }];
  const rewardLegCount = Number(await manager.drawRewardLegCount(drawId));
  for (let i = 0; i < rewardLegCount; i++) {
    const [token, amount] = await manager.drawRewardLegAt(drawId, i);
    prizeLegs.push({
      token: getAddress(token),
      amount: amount.toString(),
      feeAmount: feeBps === 0n ? "0" : ((BigInt(amount) * feeBps) / 10000n).toString(),
    });
  }

  return {
    algoVersion: "everdraw-v5-draw-algorithm/1",
    drawId: drawId.toString(),
    drawManager: getAddress(drawManagerAddress),
    vault: vaultAddress,
    twabController: twabAddress,
    seed: draw.seed,
    seedBlock: Number(seedBlock),
    periodStart: draw.periodStart.toString(),
    periodEnd: draw.periodEnd.toString(),
    totalTwab: draw.totalTwab.toString(),
    totalPayout: draw.totalPayout.toString(),
    prizeLegs,
    feeRecipients,
    tierBps: [10000],
    accounts,
  };
}
