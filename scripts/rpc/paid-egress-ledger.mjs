import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readJsonStrict(file, label) {
  if (!fs.existsSync(file)) {
    const error = new Error(`${label} is missing: ${file}`);
    error.code = "RPC_BUDGET_STATE_UNAVAILABLE";
    throw error;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (cause) {
    const error = new Error(`${label} is corrupt: ${file}`, { cause });
    error.code = "RPC_BUDGET_STATE_UNAVAILABLE";
    throw error;
  }
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

export function validateBudgetConfig(config) {
  if (config?.version !== 1 || !config.periodId) throw new Error("Invalid RPC budget config");
  positiveInteger(config.accountCapCu, "accountCapCu");
  positiveInteger(config.criticalReserveCu, "criticalReserveCu");
  if (config.criticalReserveCu > config.accountCapCu) throw new Error("criticalReserveCu exceeds accountCapCu");
  if (!config.roles || !config.methodCosts) throw new Error("RPC budget config is incomplete");
  for (const [name, role] of Object.entries(config.roles)) {
    positiveInteger(role.capCu, `roles.${name}.capCu`);
    if (!Array.isArray(role.methods) || role.methods.length === 0) throw new Error(`Role ${name} has no methods`);
  }
  for (const [method, cost] of Object.entries(config.methodCosts)) positiveInteger(cost, `methodCosts.${method}`);
  return config;
}

export function stateHash(state) {
  return "0x" + createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export function initialBudgetState(config) {
  validateBudgetConfig(config);
  return {
    version: 1,
    periodId: config.periodId,
    usedCu: 0,
    roles: Object.fromEntries(Object.keys(config.roles).map((role) => [role, { usedCu: 0, requests: 0 }])),
    latched: false,
    latchReason: "",
    reservations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function initializeBudgetState(configFile, stateFile, { replace = false, expectedHash = "" } = {}) {
  const config = validateBudgetConfig(readJsonStrict(configFile, "RPC budget config"));
  if (fs.existsSync(stateFile) && !replace) throw new Error("RPC budget state already exists");
  if (fs.existsSync(stateFile) && replace) {
    const current = readJsonStrict(stateFile, "RPC budget state");
    if (!expectedHash || stateHash(current) !== expectedHash) throw new Error("RPC budget state hash mismatch");
  }
  const state = initialBudgetState(config);
  atomicWrite(stateFile, state);
  return state;
}

export class BudgetLedger {
  constructor({ configFile, stateFile }) {
    this.configFile = configFile;
    this.stateFile = stateFile;
    this.lockFile = `${stateFile}.lock`;
    this.config = validateBudgetConfig(readJsonStrict(configFile, "RPC budget config"));
    this.snapshot();
  }

  #withLock(operation) {
    fs.mkdirSync(path.dirname(this.lockFile), { recursive: true });
    let handle;
    try {
      handle = fs.openSync(this.lockFile, "wx", 0o600);
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    } catch (cause) {
      const error = new Error("RPC budget lock is unavailable; refusing paid request", { cause });
      error.code = "RPC_BUDGET_LOCKED";
      throw error;
    }
    try {
      return operation();
    } finally {
      fs.closeSync(handle);
      fs.unlinkSync(this.lockFile);
    }
  }

  #readState() {
    const state = readJsonStrict(this.stateFile, "RPC budget state");
    if (state.version !== 1 || state.periodId !== this.config.periodId) {
      const error = new Error("RPC budget state/config period mismatch");
      error.code = "RPC_BUDGET_STATE_UNAVAILABLE";
      throw error;
    }
    return state;
  }

  snapshot() {
    const state = this.#readState();
    return { ...structuredClone(state), stateHash: stateHash(state) };
  }

  estimate(roleName, payload) {
    const role = this.config.roles[roleName];
    if (!role) throw Object.assign(new Error(`Unknown RPC budget role: ${roleName}`), { code: "RPC_ROLE_DENIED" });
    const requests = Array.isArray(payload) ? payload : [payload];
    if (requests.length === 0 || requests.length > Number(this.config.maxBatchItems || 20)) {
      throw Object.assign(new Error("RPC batch size denied"), { code: "RPC_METHOD_DENIED" });
    }
    let costCu = 0;
    const methods = {};
    for (const request of requests) {
      const method = String(request?.method || "");
      if (!role.methods.includes(method) || method === "eth_getLogs" || method.startsWith("debug_") || method.startsWith("trace_")) {
        throw Object.assign(new Error(`RPC method ${method || "<missing>"} denied for role ${roleName}`), { code: "RPC_METHOD_DENIED" });
      }
      const cost = this.config.methodCosts[method];
      if (!Number.isSafeInteger(Number(cost)) || Number(cost) < 1) {
        throw Object.assign(new Error(`No conservative cost configured for ${method}`), { code: "RPC_METHOD_DENIED" });
      }
      costCu += Number(cost);
      methods[method] = (methods[method] || 0) + 1;
    }
    return { role, requests, costCu, methods };
  }

  reserve(roleName, payload) {
    const estimate = this.estimate(roleName, payload);
    return this.#withLock(() => {
      const state = this.#readState();
      if (state.latched) throw Object.assign(new Error(`RPC budget latched: ${state.latchReason}`), { code: "RPC_BUDGET_LATCHED" });
      const roleState = state.roles[roleName];
      if (!roleState) throw Object.assign(new Error("RPC role state missing"), { code: "RPC_BUDGET_STATE_UNAVAILABLE" });
      if (roleState.usedCu + estimate.costCu > estimate.role.capCu) {
        throw Object.assign(new Error(`RPC role budget exhausted: ${roleName}`), { code: "RPC_BUDGET_EXHAUSTED" });
      }
      const ordinaryCeiling = this.config.accountCapCu - this.config.criticalReserveCu;
      const accountCeiling = estimate.role.critical ? this.config.accountCapCu : ordinaryCeiling;
      if (state.usedCu + estimate.costCu > accountCeiling) {
        throw Object.assign(new Error(estimate.role.critical ? "RPC account budget exhausted" : "RPC critical reserve protected"), { code: "RPC_BUDGET_EXHAUSTED" });
      }
      const reservation = {
        id: randomUUID(),
        role: roleName,
        costCu: estimate.costCu,
        methods: estimate.methods,
        reservedAt: new Date().toISOString(),
      };
      state.usedCu += estimate.costCu;
      roleState.usedCu += estimate.costCu;
      roleState.requests += estimate.requests.length;
      state.reservations = [...state.reservations.slice(-999), reservation];
      state.updatedAt = new Date().toISOString();
      atomicWrite(this.stateFile, state);
      return reservation;
    });
  }

  latch(reason) {
    return this.#withLock(() => {
      const state = this.#readState();
      state.latched = true;
      state.latchReason = String(reason).slice(0, 300);
      state.updatedAt = new Date().toISOString();
      atomicWrite(this.stateFile, state);
      return this.snapshot();
    });
  }
}
