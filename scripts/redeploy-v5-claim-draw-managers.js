import "dotenv/config";
import fs from "node:fs";
import hre from "hardhat";

const { ethers } = hre;

// ADR-0043 (V5 prize auto-compound). This script does NOT deploy the full V5 stack — the
// vault, TWAB controller, and shMON strategy are already live on UAT and hold real
// deposits/tranches; redeploying them would orphan that state. It redeploys ONLY the two
// contracts whose bytecode must change to pick up the auto-compound logic merged in PR #196 /
// #201:
//   - ClaimManagerV5 (new compound path: depositFor + opt-out registry)
//   - DrawManagerV5  (claimManager is `immutable` there, so a new ClaimManagerV5 forces a new
//     DrawManagerV5 even though DrawManagerV5's own logic is unchanged)
//
// It then queues the EXISTING PrizeVaultV5 to the new DrawManagerV5. That re-wire is timelocked
// under ADR-0042: the operator must run this script once to deploy+queue, wait the vault's
// STRATEGY_CHANGE_DELAY, then run this script again with commit mode to activate the new
// DrawManagerV5. Do not re-point keeper/indexer/frontend until the commit verifies on-chain.
//
// This script does not generate, hardcode, or print any private key. It reads a signer the
// same way scripts/deploy-v5-testnet.js already does: via hardhat network accounts config,
// which is populated from the PRIVATE_KEY env var in hardhat.config.js. That mechanism is not
// touched here.

const DEPLOYMENT_FILE = "deployments/monad-testnet.json";
const TESTNET_CHAIN_ID = 10143n;
const COMMIT_MODE = process.argv.includes("--commit");

function readDeploymentFile() {
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

function writeDeploymentFile(data) {
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2) + "\n");
}

function required(name, fallback = "") {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing ${name} env var`);
  return value;
}

function sameAddress(a, b) {
  return a?.toLowerCase() === b?.toLowerCase();
}

function isoFromTimestamp(timestamp) {
  return new Date(Number(timestamp) * 1000).toISOString();
}

async function assertTimelockedDrawManagerFlow(vault) {
  try {
    await vault.pendingDrawManager();
    await vault.pendingDrawManagerEffectiveAt();
  } catch (err) {
    throw new Error(
      "PrizeVaultV5 at the selected address does not expose the ADR-0042 timelocked draw-manager flow. " +
        "Abort before deploying new claim/draw managers; use a vault deployed from post-#207 bytecode or re-derive the runbook.",
    );
  }
}

async function deploy(name, args = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  console.log(`${name} deployed: ${address} tx=${receipt.hash}`);
  return { contract, address, tx: receipt.hash, blockNumber: receipt.blockNumber };
}

async function send(label, txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash}`);
  return receipt.hash;
}

/**
 * Finds the most recent "V5 M8 testnet soak" record in deployments/monad-testnet.json — this is
 * the currently-live UAT stack whose vault/TWAB/strategy we are re-pointing without touching.
 */
function findCurrentV5Record(data) {
  const v5Records = (data.contracts || []).filter((c) => c.source === "src/v5" && c.addresses);
  if (!v5Records.length) throw new Error("No existing src/v5 deployment record found to re-point");
  return v5Records[v5Records.length - 1];
}

async function preflightNetworkAndSigner() {
  if (hre.network.name !== "monadTestnet") {
    throw new Error("This script is testnet-only; use --network monadTestnet");
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== TESTNET_CHAIN_ID) {
    throw new Error(`Wrong chain id: got ${network.chainId}, expected ${TESTNET_CHAIN_ID}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer configured; operator must run with PRIVATE_KEY set (see hardhat.config.js)");
  return deployer;
}

async function deployAndQueue() {
  const deployer = await preflightNetworkAndSigner();

  const deploymentData = readDeploymentFile();
  const current = findCurrentV5Record(deploymentData);
  const { prizeVault, twabController } = current.addresses;
  if (!prizeVault || !twabController) {
    throw new Error(`Existing V5 record missing prizeVault/twabController: ${JSON.stringify(current.addresses)}`);
  }

  // Existing PrizeVaultV5 owner must be this signer, or queueDrawManagerChange will revert with NotOwner.
  const vault = await ethers.getContractAt("PrizeVaultV5", prizeVault);
  await assertTimelockedDrawManagerFlow(vault);
  const vaultOwner = await vault.owner();
  if (!sameAddress(vaultOwner, deployer.address)) {
    throw new Error(
      `Signer ${deployer.address} is not the PrizeVaultV5 owner (${vaultOwner}). ` +
        `queueDrawManagerChange will revert; run with the vault owner's key or transfer ownership first.`,
    );
  }

  // DrawManagerV5 constructor args carried over unchanged from the current live deployment
  // (guardian, keeper/primaryProposer, timing) — only claimManager and oracle are newly deployed
  // dependencies. The oracle itself is NOT part of ADR-0043's scope; reuse the existing one.
  const guardian = required("GUARDIAN", await vault.owner());
  const keeper = required("KEEPER", current.constructorArgs?.keeper || "");
  const oracleAddress = required("PYTH_RANDOMNESS_ORACLE", current.addresses.pythRandomnessOracle || "");
  const proposerGrace = Number(process.env.PROPOSER_GRACE_PERIOD_SEC || current.constructorArgs?.proposerGrace || 300);
  const challengeWindow = Number(process.env.CHALLENGE_WINDOW_SEC || current.constructorArgs?.challengeWindow || 900);
  const drawPeriod = Number(process.env.DRAW_PERIOD_SEC || current.constructorArgs?.drawPeriod || 3600);

  // New DrawManagerV5's firstPeriodStart must land exactly on a TWAB grid boundary
  // (constructor enforces twab.periodEndOnOrAfter(firstPeriodStart) == firstPeriodStart).
  // Default: next TWAB period boundary strictly after now, so the new draw manager starts a
  // clean period rather than mid-period.
  const twab = await ethers.getContractAt("EverdrawTwabController", twabController);
  const latest = await ethers.provider.getBlock("latest");
  const firstPeriodStartExplicit = process.env.FIRST_PERIOD_START;
  const firstPeriodStart = firstPeriodStartExplicit
    ? Number(firstPeriodStartExplicit)
    : Number(await twab.periodEndOnOrAfter(latest.timestamp + 60));

  console.log("Redeploying V5 ClaimManagerV5 + DrawManagerV5 (ADR-0043) with:");
  console.log({
    deployer: deployer.address,
    existingPrizeVault: prizeVault,
    existingTwabController: twabController,
    existingOracleReused: oracleAddress,
    guardian,
    keeper,
    proposerGrace,
    challengeWindow,
    drawPeriod,
    firstPeriodStart,
    firstPeriodStartExplicit: Boolean(firstPeriodStartExplicit),
  });

  // 1. New ClaimManagerV5, wired to the existing PrizeVaultV5 (source = new DrawManagerV5,
  //    set below, since compoundVaultFor is keyed by distribution source).
  const claimManager = await deploy("ClaimManagerV5");

  // 2. New DrawManagerV5, wired to the new ClaimManagerV5 (immutable ctor arg) and the
  //    EXISTING vault + TWAB controller + oracle.
  const drawManager = await deploy("DrawManagerV5", [
    prizeVault,
    twabController,
    claimManager.address,
    oracleAddress,
    guardian,
    keeper,
    firstPeriodStart,
    drawPeriod,
    proposerGrace,
    challengeWindow,
  ]);

  // 3. Wiring, in dependency order:
  //    a) authorize the new DrawManagerV5 as a ClaimManagerV5 distribution source
  //    b) enable auto-compound for that source, targeting the existing vault (ADR-0043 default)
  //    c) queue the existing vault to point at the new DrawManagerV5. This is timelocked under
  //       ADR-0042; it does NOT become active until commitDrawManagerChange is called after
  //       pendingDrawManagerEffectiveAt.
  const setupTxs = {
    claimAuthorizeManager: await send(
      "claimManager.setAuthorizedSource",
      claimManager.contract.setAuthorizedSource(drawManager.address, true),
    ),
    claimSetCompoundVault: await send(
      "claimManager.setCompoundVault",
      claimManager.contract.setCompoundVault(drawManager.address, prizeVault),
    ),
    vaultQueueDrawManagerChange: await send(
      "vault.queueDrawManagerChange (timelocked; run --commit after delay)",
      vault.queueDrawManagerChange(drawManager.address),
    ),
  };

  const pendingDrawManager = await vault.pendingDrawManager();
  const pendingDrawManagerEffectiveAt = await vault.pendingDrawManagerEffectiveAt();
  if (!sameAddress(pendingDrawManager, drawManager.address)) {
    throw new Error(`Pending draw manager mismatch: expected ${drawManager.address}, got ${pendingDrawManager}`);
  }

  const record = {
    role: "V5 M8 testnet soak - ADR-0043 auto-compound redeploy (ClaimManagerV5 + DrawManagerV5 only)",
    status: "deployed-draw-manager-queued",
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
    source: "src/v5",
    deployCommit: process.env.DEPLOY_COMMIT || "record-git-commit",
    adr: "decisions/0043-v5-prize-auto-compound.md",
    note:
      "Narrow redeploy: only ClaimManagerV5 + DrawManagerV5 were redeployed. prizeVault, " +
      "twabController, and shmonStrategy are UNCHANGED. The prizeVault draw-manager change was " +
      "queued through the ADR-0042 timelock and is not active until commitDrawManagerChange succeeds. " +
      "pythRandomnessOracle is UNCHANGED (reused from the prior record).",
    addresses: {
      twabController,
      shmonStrategy: current.addresses.shmonStrategy,
      prizeVault,
      claimManager: claimManager.address,
      pythRandomnessOracle: oracleAddress,
      drawManager: drawManager.address,
    },
    deployTxs: {
      claimManager: claimManager.tx,
      drawManager: drawManager.tx,
      ...setupTxs,
    },
    drawManagerTimelock: {
      pendingDrawManager,
      effectiveAt: Number(pendingDrawManagerEffectiveAt),
      effectiveAtIso: isoFromTimestamp(pendingDrawManagerEffectiveAt),
      commitCommand:
        "HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-claim-draw-managers.js --commit",
    },
    startBlock: Math.min(claimManager.blockNumber, drawManager.blockNumber),
    constructorArgs: {
      guardian,
      keeper,
      firstPeriodStart,
      drawPeriod,
      proposerGrace,
      challengeWindow,
    },
    watcherSecrets: {
      drawManagerAddressSecret: "DRAW_MANAGER_ADDRESS",
      claimManagerAddressSecret: "CLAIM_MANAGER_ADDRESS",
      fromBlockSecret: "V5_WATCHER_FROM_BLOCK",
    },
    priorAddresses: {
      claimManager: current.addresses.claimManager,
      drawManager: current.addresses.drawManager,
      note:
        "Prior ClaimManagerV5/DrawManagerV5 remain deployed and readable on-chain for any " +
        "already-registered distributions / unclaimed escrow from before this redeploy; they " +
        "are superseded, not destroyed. Winners with pre-redeploy deferred claims must still " +
        "claim against the OLD ClaimManagerV5 address.",
    },
  };

  const data = readDeploymentFile();
  data.contracts = data.contracts || [];
  data.contracts.push(record);
  writeDeploymentFile(data);

  console.log(`Recorded ADR-0043 redeploy in ${DEPLOYMENT_FILE}`);
  console.log("Operator next steps (see tasks/v5-auto-compound-uat-redeploy-runbook.md):");
  console.log(`- New DRAW_MANAGER_ADDRESS=${drawManager.address}`);
  console.log(`- New CLAIM_MANAGER_ADDRESS=${claimManager.address}`);
  console.log(`- Vault pendingDrawManager=${pendingDrawManager}`);
  console.log(`- Wait until ${isoFromTimestamp(pendingDrawManagerEffectiveAt)} (${pendingDrawManagerEffectiveAt})`);
  console.log(
    "- Then commit: HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-claim-draw-managers.js --commit",
  );
  console.log("- Do NOT re-point keeper, indexer, or frontend until the commit verifies vault.drawManager() == new DrawManagerV5.");
}

async function commitQueuedDrawManagerChange() {
  const deployer = await preflightNetworkAndSigner();
  const deploymentData = readDeploymentFile();
  const current = findCurrentV5Record(deploymentData);
  const { prizeVault, drawManager, claimManager } = current.addresses;
  if (!prizeVault || !drawManager || !claimManager) {
    throw new Error(`Latest V5 record missing prizeVault/drawManager/claimManager: ${JSON.stringify(current.addresses)}`);
  }

  const vault = await ethers.getContractAt("PrizeVaultV5", prizeVault);
  await assertTimelockedDrawManagerFlow(vault);
  const vaultOwner = await vault.owner();
  if (!sameAddress(vaultOwner, deployer.address)) {
    throw new Error(
      `Signer ${deployer.address} is not the PrizeVaultV5 owner (${vaultOwner}). ` +
        `commitDrawManagerChange will revert; run with the vault owner's key or transfer ownership first.`,
    );
  }

  const activeDrawManager = await vault.drawManager();
  if (sameAddress(activeDrawManager, drawManager)) {
    console.log(`Vault already points at ${drawManager}; nothing to commit.`);
    return;
  }

  const pendingDrawManager = await vault.pendingDrawManager();
  const pendingDrawManagerEffectiveAt = await vault.pendingDrawManagerEffectiveAt();
  if (!sameAddress(pendingDrawManager, drawManager)) {
    throw new Error(`Pending draw manager mismatch: expected ${drawManager}, got ${pendingDrawManager}`);
  }

  const latest = await ethers.provider.getBlock("latest");
  if (BigInt(latest.timestamp) < pendingDrawManagerEffectiveAt) {
    throw new Error(
      `Timelock not elapsed. pendingDrawManagerEffectiveAt=${pendingDrawManagerEffectiveAt} ` +
        `(${isoFromTimestamp(pendingDrawManagerEffectiveAt)}), latest=${latest.timestamp} (${isoFromTimestamp(latest.timestamp)}).`,
    );
  }

  const commitTx = await send("vault.commitDrawManagerChange", vault.commitDrawManagerChange());
  const verifiedDrawManager = await vault.drawManager();
  if (!sameAddress(verifiedDrawManager, drawManager)) {
    throw new Error(`Commit verification failed: expected vault.drawManager()=${drawManager}, got ${verifiedDrawManager}`);
  }

  const record = {
    role: "V5 M8 testnet soak - ADR-0043 draw-manager timelock commit",
    status: "draw-manager-committed",
    committedAt: new Date().toISOString(),
    committedBy: deployer.address,
    source: "src/v5",
    deployCommit: process.env.DEPLOY_COMMIT || "record-git-commit",
    adr: "decisions/0043-v5-prize-auto-compound.md",
    note:
      "Commit record for the ADR-0043 redeploy queued in a prior deployment record. The vault now " +
      "points at the new DrawManagerV5; keeper/indexer/frontend may be re-pointed after verifying this record.",
    addresses: {
      twabController: current.addresses.twabController,
      shmonStrategy: current.addresses.shmonStrategy,
      prizeVault,
      claimManager,
      pythRandomnessOracle: current.addresses.pythRandomnessOracle,
      drawManager,
    },
    deployTxs: {
      vaultCommitDrawManagerChange: commitTx,
    },
    startBlock: current.startBlock,
    constructorArgs: current.constructorArgs,
    watcherSecrets: current.watcherSecrets,
    priorAddresses: current.priorAddresses,
  };

  const data = readDeploymentFile();
  data.contracts = data.contracts || [];
  data.contracts.push(record);
  writeDeploymentFile(data);

  console.log(`Recorded ADR-0043 draw-manager commit in ${DEPLOYMENT_FILE}`);
  console.log(`Verified vault.drawManager()=${verifiedDrawManager}`);
  console.log("Operator next steps (see tasks/v5-auto-compound-uat-redeploy-runbook.md):");
  console.log(`- Re-point keeper DRAW_MANAGER_ADDRESS=${drawManager} CLAIM_MANAGER_ADDRESS=${claimManager}`);
  console.log("- Re-point indexer (everdraw-indexer-uat POOL_ADDRESSES/START_BLOCK) + backfill");
  console.log("- Re-point frontend (Vercel everdraw-v5-uat VITE_V5_DRAW_MANAGER_ADDRESS / VITE_V5_CLAIM_MANAGER_ADDRESS) + redeploy");
}

async function main() {
  if (COMMIT_MODE) {
    await commitQueuedDrawManagerChange();
  } else {
    await deployAndQueue();
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
