import "dotenv/config";
import { execFileSync } from "node:child_process";
import hre from "hardhat";
const { ethers } = hre;

async function main() {
  if (hre.network.name === "monadMainnet") {
    execFileSync("node", ["scripts/deploy-preflight.mjs"], { stdio: "inherit" });
  }

  const shmon = process.env.SHMON;
  if (!shmon) throw new Error("Missing SHMON env var");

  const ticketPrice = process.env.TICKET_PRICE_MON || "1";
  const commitDelayBlocks = Number(process.env.COMMIT_DELAY_BLOCKS || 5);
  const depositPeriodSec = Number(process.env.DEPOSIT_PERIOD_SEC || 86400);
  const yieldPeriodSec = Number(process.env.YIELD_PERIOD_SEC || 604800);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log({ shmon, ticketPrice, commitDelayBlocks, depositPeriodSec, yieldPeriodSec });

  const Factory = await ethers.getContractFactory("TicketPrizePoolShmonShMonad");
  const pool = await Factory.deploy(
    ethers.parseEther(ticketPrice),
    commitDelayBlocks,
    depositPeriodSec,
    yieldPeriodSec,
    shmon
  );
  await pool.waitForDeployment();

  const addr = await pool.getAddress();
  console.log("TicketPrizePoolShmonShMonad deployed:", addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
