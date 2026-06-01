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
