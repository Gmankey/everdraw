import fs from "node:fs";
import path from "node:path";

const STATE_VERSION = 1;

export const TERMINAL_CLAIM_ERRORS = new Map([
  ["0x09bde339", "InvalidProof"],
  ["0x3a35c2f9", "DistributionNotFound"],
  ["0x646cf558", "AlreadyClaimed"],
  ["0x89d99da3", "BadLeaf"],
]);

function errorValues(err) {
  return [
    err?.data,
    err?.info?.error?.data,
    err?.error?.data,
    err?.revert?.data,
    err?.revert?.name,
    err?.revert?.signature,
    err?.reason,
    err?.shortMessage,
    err?.message,
  ].filter((value) => typeof value === "string");
}

export function terminalClaimError(err) {
  for (const value of errorValues(err)) {
    const normalized = value.toLowerCase();
    for (const [selector, name] of TERMINAL_CLAIM_ERRORS) {
      if (normalized.includes(selector) || normalized.includes(name.toLowerCase())) {
        return { selector, name };
      }
    }
  }
  return null;
}

export function claimStateKey(drawManagerAddress, claimManagerAddress, drawId) {
  return [
    String(drawManagerAddress).toLowerCase(),
    String(claimManagerAddress).toLowerCase(),
    BigInt(drawId).toString(),
  ].join(":");
}

function emptyState() {
  return { version: STATE_VERSION, claims: {} };
}

export class ClaimRetryState {
  constructor(file) {
    this.file = file;
    this.state = this.#read();
  }

  #read() {
    if (!fs.existsSync(this.file)) return emptyState();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (parsed?.version !== STATE_VERSION || typeof parsed?.claims !== "object") {
        throw new Error(`unsupported state version ${parsed?.version}`);
      }
      return parsed;
    } catch (err) {
      throw new Error(`failed to read keeper claim state ${this.file}: ${err?.message || err}`);
    }
  }

  #write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }

  isQuarantined(key) {
    return this.state.claims[key]?.status === "quarantined";
  }

  quarantine(key, { drawId, selector, name, message, now = new Date().toISOString() }) {
    if (this.isQuarantined(key)) return false;
    this.state.claims[key] = {
      status: "quarantined",
      drawId: BigInt(drawId).toString(),
      selector,
      error: name,
      message,
      quarantinedAt: now,
    };
    this.#write();
    return true;
  }

  recordTransientFailure(key, { drawId, message, now = new Date().toISOString() }) {
    const existing = this.state.claims[key];
    if (existing?.status === "quarantined") return existing;
    const next = {
      status: "retrying",
      drawId: BigInt(drawId).toString(),
      failures: Number(existing?.failures || 0) + 1,
      message,
      lastFailedAt: now,
    };
    this.state.claims[key] = next;
    this.#write();
    return next;
  }

  clearTransientFailure(key) {
    if (this.state.claims[key]?.status !== "retrying") return false;
    delete this.state.claims[key];
    this.#write();
    return true;
  }

  quarantinedCount() {
    return Object.values(this.state.claims).filter((entry) => entry.status === "quarantined").length;
  }
}

export function reachedTransientAlertThreshold(failures, threshold) {
  if (!Number.isInteger(threshold) || threshold <= 0) {
    throw new Error(`invalid transient claim alert threshold: ${threshold}`);
  }
  return failures === threshold;
}

export async function claimFinalizedDrawSafely(
  drawId,
  claim,
  {
    onSuccess = async () => {},
    onTerminal = async () => {},
    onTransient = async () => {},
  } = {},
) {
  let result;
  try {
    result = await claim();
  } catch (err) {
    const detail = err?.shortMessage || err?.reason || err?.message || String(err);
    const terminal = terminalClaimError(err);
    if (terminal) {
      const message = `claim draw ${drawId} quarantined: ${terminal.name} (${terminal.selector}): ${detail}`;
      console.warn(message);
      await onTerminal(err, terminal, message);
      return false;
    }

    const message = `claim draw ${drawId} failed transiently; continuing lifecycle: ${detail}`;
    console.error(message);
    await onTransient(err, message);
    return false;
  }

  await onSuccess(result);
  return result;
}
