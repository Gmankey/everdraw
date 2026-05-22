import "dotenv/config";
import hre from "hardhat";
const { ethers } = hre;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error("Missing " + name + " env var");
  return value;
}

async function waitFor(label, fn, { timeoutMs = 15 * 60 * 1000, intervalMs = 10_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for " + label);
}

async function tx(label, promise) {
  const pending = await promise;
  console.log(label + ": " + pending.hash);
  const receipt = await pending.wait();
  console.log(label + " mined in block " + receipt.blockNumber);
  return receipt;
}

async function main() {
  if (hre.network.name !== "monadTestnet") {
    throw new Error("Smoke test is testnet-only; run with --network monadTestnet");
  }

  const poolAddress = requireEnv("POOL_ADDRESS");
  const vrfReserveMON = process.env.VRF_RESERVE_MON || "0.1";
  const ticketCount = Number(process.env.SMOKE_TICKET_COUNT || 1);

  const [signer] = await ethers.getSigners();
  const pool = await ethers.getContractAt("TicketPrizePoolShmonV3", poolAddress, signer);

  const roundId = await pool.currentRoundId();
  const ticketPriceMON = await pool.ticketPriceMON();
  const buyValue = ticketPriceMON * BigInt(ticketCount);

  console.log("V3 smoke test starting");
  console.log({
    network: hre.network.name,
    signer: signer.address,
    pool: poolAddress,
    roundId: roundId.toString(),
    ticketCount,
    buyValue: buyValue.toString()
  });

  await tx("depositVRFReserve", pool.depositVRFReserve({ value: ethers.parseEther(vrfReserveMON) }));
  await tx("buyTicketsMON", pool.buyTicketsMON(ticketCount, { value: buyValue }));

  const commitAfter = await pool.getCommitAfterTime(roundId);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (commitAfter > now) {
    const waitMs = Number(commitAfter - now) * 1000 + 2_000;
    console.log("Waiting " + Math.ceil(waitMs / 1000) + "s until commit is eligible");
    await sleep(waitMs);
  }

  await tx("commitDraw", pool.commitDraw(roundId));

  await waitFor("Pyth VRF callback", async () => {
    const state = await pool.getRoundState(roundId);
    console.log("round state", state.toString());
    return state === 2n; // RoundState.Drawn
  });

  await tx("finalizeDraw", pool.finalizeDraw(roundId));

  const info = await pool.getRoundInfo(roundId);
  const winner = info[9];
  console.log({
    winner,
    winningTicket: info[10].toString(),
    prizeShares: info[7].toString()
  });

  if (winner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Smoke signer is not winner: " + winner);
  }

  await tx("claimPrize", pool.claimPrize(roundId));
  await tx("withdrawPrincipal", pool.withdrawPrincipal(roundId));

  const position = await pool.getUserPosition(roundId, signer.address);
  console.log({
    finalPrincipalMON: position[0].toString(),
    finalPrincipalShmonShares: position[1].toString()
  });
  console.log("V3 smoke test complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
