import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function failure(message) {
  return Object.assign(new Error(message), { code: "RPC_QUALIFICATION_ADMISSION_UNAVAILABLE" });
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw failure(`Invalid ${label}`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw failure(`Invalid ${label}`);
}

function readJson(file, label) {
  if (!fs.existsSync(file)) throw failure(`${label} is missing: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw failure(`${label} is corrupt: ${file}`);
  }
}

function durableWrite(file, value) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temp, file);
  const directoryHandle = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(directoryHandle);
  } finally {
    fs.closeSync(directoryHandle);
  }
}

function withLock(stateFile, operation) {
  const lockFile = `${stateFile}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  let handle;
  try {
    handle = fs.openSync(lockFile, "wx", 0o600);
    fs.writeFileSync(handle, `${process.pid}\n`);
    fs.fsyncSync(handle);
  } catch {
    if (handle != null) fs.closeSync(handle);
    throw failure("Qualification admission ledger is locked");
  }
  try {
    return operation();
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lockFile);
  }
}

export function validateQualificationPolicy(policy) {
  if (policy?.version !== 1 || typeof policy.periodId !== "string" || !policy.periodId) throw failure("Invalid qualification policy");
  if (!/^0x[0-9a-f]{64}$/.test(policy.providerIdentity || "")) throw failure("Invalid qualification provider identity");
  integer(policy.accountRequestCap, "accountRequestCap", 1);
  integer(policy.attemptRequestCap, "attemptRequestCap", 1);
  integer(policy.cooldownSec, "cooldownSec");
  if (policy.attemptRequestCap > policy.accountRequestCap) throw failure("Attempt cap exceeds account cap");
  return policy;
}

function initialState(policy) {
  const now = new Date().toISOString();
  return { version: 1, periodId: policy.periodId, providerIdentity: policy.providerIdentity, usedRequests: 0, attempts: {}, createdAt: now, updatedAt: now };
}

function validateState(policy, state) {
  if (state?.version !== 1 || state.periodId !== policy.periodId || state.providerIdentity !== policy.providerIdentity) {
    throw failure("Qualification admission state does not match policy");
  }
  integer(state.usedRequests, "state.usedRequests");
  if (state.usedRequests > policy.accountRequestCap || !state.attempts || typeof state.attempts !== "object" || Array.isArray(state.attempts)) {
    throw failure("Invalid qualification admission state");
  }
  let total = 0;
  for (const [id, attempt] of Object.entries(state.attempts)) {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(id) || !/^[0-9a-f]{40}$/.test(attempt?.sourceCommit || "")) throw failure("Invalid qualification attempt identity");
    integer(attempt.requests, `attempts.${id}.requests`);
    if (attempt.requests > policy.attemptRequestCap || attempt.providerIdentity !== policy.providerIdentity) throw failure("Invalid qualification attempt accounting");
    timestamp(attempt.startedAt, `attempts.${id}.startedAt`);
    timestamp(attempt.updatedAt, `attempts.${id}.updatedAt`);
    total += attempt.requests;
  }
  if (!Number.isSafeInteger(total) || total !== state.usedRequests) throw failure("Qualification account and attempt counters disagree");
  timestamp(state.createdAt, "state.createdAt");
  timestamp(state.updatedAt, "state.updatedAt");
  return state;
}

function validateExistingState(state) {
  if (state?.version !== 1 || typeof state.periodId !== "string" || !state.periodId || typeof state.providerIdentity !== "string") {
    throw failure("Existing qualification admission state is invalid");
  }
  integer(state.usedRequests, "state.usedRequests");
  if (!state.attempts || typeof state.attempts !== "object" || Array.isArray(state.attempts)) throw failure("Existing qualification attempts are invalid");
  timestamp(state.createdAt, "state.createdAt");
  timestamp(state.updatedAt, "state.updatedAt");
  return state;
}

export function qualificationStateHash(state) {
  return "0x" + createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export function initializeQualificationAdmission(policyFile, stateFile, { replace = false, expectedHash = "" } = {}) {
  const policy = validateQualificationPolicy(readJson(policyFile, "Qualification policy"));
  return withLock(stateFile, () => {
    if (fs.existsSync(stateFile)) {
      const current = validateExistingState(readJson(stateFile, "Qualification admission state"));
      if (!replace) throw failure("Qualification admission state already exists");
      if (!expectedHash || qualificationStateHash(current) !== expectedHash) throw failure("Qualification admission state hash mismatch");
      if (current.periodId === policy.periodId) throw failure("Refusing to reset the active qualification period");
    }
    const state = initialState(policy);
    durableWrite(stateFile, state);
    return state;
  });
}

export class QualificationAdmissionLedger {
  constructor({ policyFile, stateFile, expectedPolicyHash = "" }) {
    this.policyFile = policyFile;
    this.stateFile = stateFile;
    const bytes = fs.readFileSync(policyFile);
    this.policyHash = "0x" + createHash("sha256").update(bytes).digest("hex");
    if (expectedPolicyHash && this.policyHash !== expectedPolicyHash.toLowerCase()) throw failure("Qualification policy hash mismatch");
    this.policy = validateQualificationPolicy(JSON.parse(bytes));
    this.snapshot();
  }

  #read() {
    return validateState(this.policy, readJson(this.stateFile, "Qualification admission state"));
  }

  snapshot() {
    const state = this.#read();
    return { ...structuredClone(state), stateHash: qualificationStateHash(state), policyHash: this.policyHash };
  }

  start({ qualificationId, sourceCommit, providerIdentity }) {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(qualificationId || "") || !/^[0-9a-f]{40}$/.test(sourceCommit || "")) throw failure("Invalid qualification identity");
    if (providerIdentity !== this.policy.providerIdentity) throw failure("Qualification provider identity is not approved");
    return withLock(this.stateFile, () => {
      const state = this.#read();
      const existing = state.attempts[qualificationId];
      if (existing) {
        if (existing.sourceCommit !== sourceCommit || existing.providerIdentity !== providerIdentity) throw failure("Qualification ID is bound to different reviewed inputs");
        return { resumed: true, attempt: structuredClone(existing), usedRequests: state.usedRequests, accountRequestCap: this.policy.accountRequestCap };
      }
      const latestStart = Math.max(0, ...Object.values(state.attempts).map((attempt) => Date.parse(attempt.startedAt)));
      if (latestStart && Date.now() - latestStart < this.policy.cooldownSec * 1000) throw failure("Qualification cooldown is active");
      if (Object.keys(state.attempts).length >= 100) throw failure("Qualification attempt history is full");
      const now = new Date().toISOString();
      state.attempts[qualificationId] = { sourceCommit, providerIdentity, requests: 0, startedAt: now, updatedAt: now };
      state.updatedAt = now;
      durableWrite(this.stateFile, validateState(this.policy, state));
      return { resumed: false, attempt: structuredClone(state.attempts[qualificationId]), usedRequests: state.usedRequests, accountRequestCap: this.policy.accountRequestCap };
    });
  }

  reserve(qualificationId, count = 1) {
    integer(count, "reservation count", 1);
    return withLock(this.stateFile, () => {
      const state = this.#read();
      const attempt = state.attempts[qualificationId];
      if (!attempt) throw failure("Qualification attempt is not admitted");
      if (attempt.requests + count > this.policy.attemptRequestCap) throw failure("Qualification attempt request cap exceeded");
      if (state.usedRequests + count > this.policy.accountRequestCap) throw failure("Qualification provider-period request cap exceeded");
      const now = new Date().toISOString();
      attempt.requests += count;
      attempt.updatedAt = now;
      state.usedRequests += count;
      state.updatedAt = now;
      durableWrite(this.stateFile, validateState(this.policy, state));
      return { qualificationId, attemptRequests: attempt.requests, attemptRequestCap: this.policy.attemptRequestCap, usedRequests: state.usedRequests, accountRequestCap: this.policy.accountRequestCap };
    });
  }
}
