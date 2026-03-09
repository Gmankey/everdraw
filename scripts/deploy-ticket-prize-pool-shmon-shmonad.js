import "dotenv/config";
import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const shmon = process.env.SHMON;
  if (!shmon) throw new Error("Missing SHMON env var");

  const ticketPrice = process.env.TICKET_PRICE_MON || "1";
  const commitDelayBlocks = Number(process.env.COMMIT_DELAY_BLOCKS || 5);
  const roundDurationSec = Number(process.env.ROUND_DURATION_SEC || 600);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log({ shmon, ticketPrice, commitDelayBlocks, roundDurationSec });

  const Factory = await ethers.getContractFactory("TicketPrizePoolShmonShMonad");
  const pool = await Factory.deploy(
    ethers.parseEther(ticketPrice),
    commitDelayBlocks,
    roundDurationSec,
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
