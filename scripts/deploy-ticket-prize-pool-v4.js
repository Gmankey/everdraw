import "dotenv/config";
import { execFileSync } from "node:child_process";
import hre from "hardhat";
const { ethers } = hre;

async function main() {
  if (hre.network.name === "monadMainnet") {
    execFileSync("node", ["scripts/deploy-preflight.mjs"], { stdio: "inherit" });
  }

  const yieldVault = process.env.YIELD_VAULT || process.env.SHMON;
  const entropy = process.env.ENTROPY;
  const entropyProvider = process.env.ENTROPY_PROVIDER;
  const asset = process.env.ASSET || ethers.ZeroAddress;
  const depositMode = Number(process.env.DEPOSIT_MODE || "0"); // 0 Native, 1 ERC20
  const vaultSymbol = process.env.VAULT_SYMBOL || (depositMode === 0 ? "EVRDRAW-MON" : "EVRDRAW-ASSET");

  if (!yieldVault) throw new Error("Missing YIELD_VAULT (or SHMON) env var");
  if (!entropy) throw new Error("Missing ENTROPY env var");
  if (!entropyProvider) throw new Error("Missing ENTROPY_PROVIDER env var");
  if (depositMode === 0 && asset !== ethers.ZeroAddress) throw new Error("Native mode requires ASSET=0x0");
  if (depositMode === 1 && asset === ethers.ZeroAddress) throw new Error("ERC20 mode requires ASSET");

  const defaultRoundDurationSec = hre.network.name === "monadTestnet" ? 120 : 86400;
  const defaultYieldPeriodSec = hre.network.name === "monadTestnet" ? 300 : 518100;
  const ticketPriceAsset = ethers.parseUnits(process.env.TICKET_PRICE_ASSET || "1", Number(process.env.ASSET_DECIMALS || "18"));
  const roundDurationSec = Number(process.env.ROUND_DURATION_SEC || defaultRoundDurationSec);
  const yieldPeriodSec = Number(process.env.YIELD_PERIOD_SEC || defaultYieldPeriodSec);
  const numWinners = Number(process.env.NUM_WINNERS || "1");
  const winnerAllocationBps = (process.env.WINNER_ALLOCATION_BPS || "10000").split(",").map((v) => Number(v.trim()));

  // ── Cadence stagger guard (ADR-0010) ──────────────────────────────────────
  // Two vaults must run ~half a weekly cycle (3.5 days) apart so their draws
  // stay spread across the week. This guard makes that invariant unbreakable:
  // when deploying a SECOND vault, set STAGGER_REFERENCE_VAULT to its sibling's
  // address. The script reads the sibling's anchor on-chain and ABORTS if this
  // deploy would land outside tolerance of the 3.5-day offset. Leave the env var
  // unset for the first vault or testnet. This exists because the 2026-06 launch
  // deployed both vaults ~55 minutes apart, collapsing the stagger.
  const staggerRef = process.env.STAGGER_REFERENCE_VAULT;
  if (staggerRef && hre.network.name !== "monadTestnet") {
    const cycle = roundDurationSec + yieldPeriodSec;                 // ~weekly
    const halfCycle = Math.floor(cycle / 2);                         // intended stagger (~3.5d)
    const toleranceSec = Number(process.env.STAGGER_TOLERANCE_SEC || 43200); // 12h default
    let refSalesEnd = 0;
    try {
      const ref = new ethers.Contract(
        staggerRef,
        ["function getRoundTimes(uint256) view returns (uint64 salesEndTime, uint64 vrfRequestTime)"],
        ethers.provider,
      );
      const [se] = await ref.getRoundTimes(1n);
      refSalesEnd = Number(se);
      if (!refSalesEnd) throw new Error("reference vault round-1 salesEndTime is 0");
    } catch (e) {
      const msg = `STAGGER GUARD: could not read reference vault ${staggerRef}: ${e.message}`;
      if (process.env.STAGGER_OVERRIDE === "1") console.warn("⚠️  " + msg + " — proceeding due to STAGGER_OVERRIDE=1");
      else throw new Error(msg + "\nFix STAGGER_REFERENCE_VAULT / RPC, or set STAGGER_OVERRIDE=1 to bypass (NOT recommended).");
    }
    if (refSalesEnd) {
      const now = Math.floor(Date.now() / 1000);
      const newSalesEnd = now + roundDurationSec;                    // this vault's round-1 anchor (approx)
      const gap = (((newSalesEnd - refSalesEnd) % cycle) + cycle) % cycle;
      const distance = Math.abs(gap - halfCycle);
      const d = (s) => (s / 86400).toFixed(2);
      console.log(
        `Stagger guard: sibling anchor ${new Date(refSalesEnd * 1000).toISOString()} | this gap ${d(gap)}d | target ${d(halfCycle)}d | tol ±${(toleranceSec / 3600).toFixed(0)}h`,
      );
      if (distance > toleranceSec) {
        let nextDeploy = refSalesEnd + halfCycle - roundDurationSec; // T + roundDuration ≡ refSalesEnd + halfCycle (mod cycle)
        while (nextDeploy < now) nextDeploy += cycle;
        const m =
          `STAGGER GUARD ABORT (ADR-0010): deploying now would put this vault ${d(gap)} days from the sibling, ` +
          `but the required stagger is ${d(halfCycle)} days (±${(toleranceSec / 3600).toFixed(0)}h). ` +
          `Next acceptable deploy time: ${new Date(nextDeploy * 1000).toISOString()} ` +
          `(repeats every ${d(cycle)} days). Deploy in that window, or override with STAGGER_OVERRIDE=1 (records a deliberate deviation).`;
        if (process.env.STAGGER_OVERRIDE === "1") console.warn("⚠️  " + m + "\n— proceeding anyway due to STAGGER_OVERRIDE=1");
        else throw new Error(m);
      } else {
        console.log("✅ Stagger guard passed — cadence offset within tolerance.");
      }
    }
  } else if (!staggerRef) {
    console.log("Stagger guard: STAGGER_REFERENCE_VAULT not set — skipping (first vault / testnet).");
  }

  const [deployer] = await ethers.getSigners();
  const nonce = await deployer.getNonce();
  const predictedVault = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });

  console.log("Deploying V4 with:", deployer.address);
  console.log({ predictedVault, yieldVault, entropy, entropyProvider, asset, depositMode, ticketPriceAsset: ticketPriceAsset.toString(), roundDurationSec, yieldPeriodSec, numWinners, winnerAllocationBps, vaultSymbol });

  const OracleFactory = await ethers.getContractFactory("PythRandomnessOracle");
  const oracle = await OracleFactory.deploy(entropy, entropyProvider, predictedVault);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("PythRandomnessOracle deployed:", oracleAddr);

  const PoolFactory = await ethers.getContractFactory("TicketPrizePoolV4");
  const pool = await PoolFactory.deploy({
    depositMode,
    asset,
    yieldVault,
    ticketPriceAsset,
    roundDurationSec,
    yieldPeriodSec,
    numWinners,
    winnerAllocationBps,
    randomnessOracle: oracleAddr,
    randomnessOracleInitData: "0x",
    vaultSymbol,
  });
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("TicketPrizePoolV4 deployed:", poolAddr);
  if (poolAddr.toLowerCase() !== predictedVault.toLowerCase()) {
    throw new Error(`Predicted vault mismatch: predicted ${predictedVault}, got ${poolAddr}`);
  }
  console.log("Seed VRF reserve with 20 MON before production use:");
  console.log(` cast send ${poolAddr} "depositVRFReserve()" --value 20ether --rpc-url $RPC_URL --private-key $PRIVATE_KEY`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
