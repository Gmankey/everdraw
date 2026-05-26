/**
 * Deploy script for TicketPrizePoolShmonV2 (Vault A / Vault B role).
 *
 * Constructor params are taken from ADR-0010 (cadence invariant).
 * Env vars let you override for unusual deploys, but the defaults ARE the spec.
 *
 * Required env:
 *   PRIVATE_KEY  — deployer/owner wallet private key
 *   RPC_URL      — Monad mainnet RPC
 *
 * Optional env (defaults match ADR-0010):
 *   SHMON               — shMON address (default: mainnet)
 *   TICKET_PRICE_MON    — ticket price in MON (default: 1)
 *   ROUND_DURATION_SEC  — deposit window in seconds (default: 86400 = 24h)
 *   YIELD_PERIOD_SEC    — yield phase in seconds (default: 518100 ≈ 5d 23h 55m)
 *   OWNER               — contract owner address (default: deployer address)
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import hre from 'hardhat';
const { ethers } = hre;

// ADR-0010 cadence invariant — do not change without amending the ADR.
const ADR0010 = {
  shmon:             '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c',
  ticketPriceMON:    '1',       // ETH units → parsed below
  roundDurationSec:  86400,     // 24h deposit window
  yieldPeriodSec:    518100,    // ≈ 5d 23h 55m yield phase
};

async function main() {
  if (hre.network.name === 'monadMainnet') {
    execFileSync('node', ['scripts/deploy-preflight.mjs'], { stdio: 'inherit' });
  }

  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);

  const shmon            = process.env.SHMON             ?? ADR0010.shmon;
  const ticketPriceMON   = ethers.parseEther(process.env.TICKET_PRICE_MON   ?? ADR0010.ticketPriceMON);
  const roundDurationSec = Number(process.env.ROUND_DURATION_SEC ?? ADR0010.roundDurationSec);
  const yieldPeriodSec   = Number(process.env.YIELD_PERIOD_SEC   ?? ADR0010.yieldPeriodSec);
  const owner            = process.env.OWNER ?? deployer.address;

  // Sanity-check against ADR-0010 values (warn, not hard-fail, to allow testnet overrides).
  if (hre.network.name === 'monadMainnet') {
    const warnings = [];
    if (shmon.toLowerCase() !== ADR0010.shmon.toLowerCase())
      warnings.push(`  shmon: ${shmon} (ADR-0010 expects ${ADR0010.shmon})`);
    if (roundDurationSec !== ADR0010.roundDurationSec)
      warnings.push(`  roundDurationSec: ${roundDurationSec} (ADR-0010 expects ${ADR0010.roundDurationSec})`);
    if (yieldPeriodSec !== ADR0010.yieldPeriodSec)
      warnings.push(`  yieldPeriodSec: ${yieldPeriodSec} (ADR-0010 expects ${ADR0010.yieldPeriodSec})`);
    if (warnings.length) {
      console.error('\n[deploy] ⚠️  PARAM MISMATCH vs ADR-0010 — deploying anyway, but verify before promoting:\n' + warnings.join('\n') + '\n');
    }
  }

  console.log('\nDeploy params:');
  console.log({
    shmon,
    ticketPriceMON: ticketPriceMON.toString(),
    roundDurationSec,
    yieldPeriodSec,
    owner,
  });

  const Factory = await ethers.getContractFactory('TicketPrizePoolShmonV2');
  const pool = await Factory.deploy(shmon, ticketPriceMON, roundDurationSec, yieldPeriodSec, owner);
  await pool.waitForDeployment();

  const addr = await pool.getAddress();
  console.log('\n✅ TicketPrizePoolShmonV2 deployed:', addr);

  console.log('\n── Post-deploy verification (ADR-0010) ──────────────────────────────');
  console.log('Run the following and confirm ALL values match ADR-0010 for BOTH Vault A and the new contract:\n');
  const vaultA = '0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888';
  for (const [label, contractAddr] of [['Vault A', vaultA], ['New Vault B', addr]]) {
    console.log(`# ${label} (${contractAddr})`);
    for (const fn of ['roundDurationSec()', 'yieldPeriodSec()', 'ticketPriceMON()', 'shmon()', 'owner()']) {
      console.log(`cast call ${contractAddr} '${fn}' --rpc-url $RPC_URL`);
    }
    console.log('');
  }

  console.log('── Next steps (ADR-0011 sequencing) ─────────────────────────────────');
  console.log('1. Confirm verification output above matches ADR-0010 table side-by-side.');
  console.log('2. Update keeper-mainnet.env: add new address to POOL_ADDRESSES and POOL_ADDRESSES_V2.');
  console.log('3. Update POOL_SCHEDULE_V2: add new address with Sun 01:00 UTC anchor.');
  console.log('4. Restart keeper watchdog.');
  console.log('5. Update Vercel VITE_POOL_ADDRESSES_V2 to include new address (manual step in Vercel dashboard).');
  console.log('6. Update deployments/monad-mainnet.json with new contract address and commit.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
