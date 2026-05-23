import "dotenv/config";
import { execFileSync } from "node:child_process";
import hre from "hardhat";
const { ethers } = hre;

async function main() {
  if (hre.network.name === "monadMainnet") {
    execFileSync("node", ["scripts/deploy-preflight.mjs"], { stdio: "inherit" });
  }

  const shmon = process.env.SHMON;
  const owner = process.env.OWNER;
  if (!shmon) throw new Error("Missing SHMON env var");
  if (!owner) throw new Error("Missing OWNER env var");

  const ticketPriceMON = ethers.parseEther(process.env.TICKET_PRICE_MON || "1");
  const roundDurationSec = Number(process.env.ROUND_DURATION_SEC || 86400);
  const yieldPeriodSec = Number(process.env.YIELD_PERIOD_SEC || 518100);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying TicketPrizePoolShmonV2 with:", deployer.address);
  console.log({ shmon, ticketPriceMON: ticketPriceMON.toString(), roundDurationSec, yieldPeriodSec, owner });

  const Factory = await ethers.getContractFactory("TicketPrizePoolShmonV2");
  const pool = await Factory.deploy(shmon, ticketPriceMON, roundDurationSec, yieldPeriodSec, owner);
  await pool.waitForDeployment();

  const addr = await pool.getAddress();
  console.log("TicketPrizePoolShmonV2 deployed:", addr);

  const keeperAddress = process.env.KEEPER_ADDRESS;
  if (keeperAddress) {
    console.log(`Calling setKeeper(${keeperAddress}, true)...`);
    const tx = await pool.setKeeper(keeperAddress, true);
    await tx.wait();
    console.log("setKeeper confirmed.");
  } else {
    console.log("KEEPER_ADDRESS not set — skipping setKeeper. Run manually:");
    console.log(` cast send ${addr} "setKeeper(address,bool)" <keeper_addr> true --rpc-url $RPC_URL --private-key $OWNER_KEY`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
