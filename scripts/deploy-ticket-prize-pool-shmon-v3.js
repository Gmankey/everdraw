import "dotenv/config";
import { execFileSync } from "node:child_process";
import hre from "hardhat";
const { ethers } = hre;

async function main() {
  if (hre.network.name === "monadMainnet") {
    execFileSync("node", ["scripts/deploy-preflight.mjs"], { stdio: "inherit" });
  }

  const shmon = process.env.SHMON;
  const entropy = process.env.ENTROPY;
  const entropyProvider = process.env.ENTROPY_PROVIDER;

  if (!shmon) throw new Error("Missing SHMON env var");
  if (!entropy) throw new Error("Missing ENTROPY env var");
  if (!entropyProvider) throw new Error("Missing ENTROPY_PROVIDER env var");

  const ticketPriceMON = ethers.parseEther(process.env.TICKET_PRICE_MON || "1");
  const roundDurationSec = Number(process.env.ROUND_DURATION_SEC || 86400);
  const yieldPeriodSec = Number(process.env.YIELD_PERIOD_SEC || 518100);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying TicketPrizePoolShmonV3 with:", deployer.address);
  console.log({
    shmon,
    entropy,
    entropyProvider,
    ticketPriceMON: ticketPriceMON.toString(),
    roundDurationSec,
    yieldPeriodSec
  });

  const Factory = await ethers.getContractFactory("TicketPrizePoolShmonV3");
  const pool = await Factory.deploy(
    ticketPriceMON,
    roundDurationSec,
    yieldPeriodSec,
    shmon,
    entropy,
    entropyProvider
  );
  await pool.waitForDeployment();

  const addr = await pool.getAddress();
  console.log("TicketPrizePoolShmonV3 deployed:", addr);
  console.log("Seed VRF reserve with at least 0.1 MON:");
  console.log(
    ' cast send ' + addr + ' "depositVRFReserve()" --value 0.1ether --rpc-url $RPC_URL --private-key $PRIVATE_KEY'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
