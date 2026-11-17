import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function stateError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "RPC_BUDGET_STATE_UNAVAILABLE";
  return error;
}

function durableWrite(file, value) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(handle, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(temp, file);
    const directoryHandle = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryHandle);
    } finally {
      fs.closeSync(directoryHandle);
    }
  } catch (error) {
    if (handle !== undefined) fs.closeSync(handle);
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function readJsonStrict(file, label) {
  if (!fs.existsSync(file)) throw stateError(`${label} is missing: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (cause) {
    throw stateError(`${label} is corrupt: ${file}`, cause);
  }
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw stateError(`Invalid ${label}`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw stateError(`Invalid ${label}`);
  return value;
}

function validTimestamp(value, label) {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
    throw stateError(`Invalid ${label}`);
  }
}

export function validateBudgetConfig(config) {
  if (config?.version !== 1 || !config.periodId) throw stateError("Invalid RPC budget config");
  nonnegativeInteger(config.accountCapCu, "accountCapCu");
  nonnegativeInteger(config.criticalReserveCu, "criticalReserveCu");
  if (config.criticalReserveCu > config.accountCapCu) throw stateError("criticalReserveCu exceeds accountCapCu");
  positiveInteger(config.maxBatchItems, "maxBatchItems");
  if (!config.roles || typeof config.roles !== "object" || Array.isArray(config.roles)) {
    throw stateError("RPC budget roles are missing");
  }
  if (!config.methodCosts || typeof config.methodCosts !== "object" || Array.isArray(config.methodCosts)) {
    throw stateError("RPC method costs are missing");
  }
  for (const [name, role] of Object.entries(config.roles)) {
    nonnegativeInteger(role.capCu, `roles.${name}.capCu`);
    if (typeof role.critical !== "boolean") throw stateError(`Invalid roles.${name}.critical`);
    if (!Array.isArray(role.methods) || role.methods.length === 0 || new Set(role.methods).size !== role.methods.length) {
      throw stateError(`Role ${name} has invalid methods`);
    }
    for (const method of role.methods) {
      if (typeof method !== "string" || !method || !(method in config.methodCosts)) {
        throw stateError(`Role ${name} has uncosted method ${String(method)}`);
      }
    }
  }
  for (const [method, cost] of Object.entries(config.methodCosts)) positiveInteger(cost, `methodCosts.${method}`);
  return config;
}

export function stateHash(state) {
  return "0x" + createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export function initialBudgetState(config) {
  validateBudgetConfig(config);
  const now = new Date().toISOString();
  return {
    version: 1,
    periodId: config.periodId,
    usedCu: 0,
    roles: Object.fromEntries(Object.keys(config.roles).map((role) => [role, { usedCu: 0, requests: 0 }])),
    latched: false,
    latchReason: "",
    reservations: [],
    createdAt: now,
    updatedAt: now,
  };
}

function validateGenericExistingState(state) {
  if (!state || state.version !== 1 || typeof state.periodId !== "string" || !state.periodId) {
    throw stateError("Existing RPC budget state is invalid");
  }
  nonnegativeInteger(state.usedCu, "state.usedCu");
  if (!state.roles || typeof state.roles !== "object" || Array.isArray(state.roles)) {
    throw stateError("Existing RPC role state is invalid");
  }
  for (const [role, value] of Object.entries(state.roles)) {
    nonnegativeInteger(value?.usedCu, `state.roles.${role}.usedCu`);
    nonnegativeInteger(value?.requests, `state.roles.${role}.requests`);
  }
  if (typeof state.latched !== "boolean" || typeof state.latchReason !== "string") {
    throw stateError("Existing RPC latch state is invalid");
  }
  if (!Array.isArray(state.reservations)) throw stateError("Existing RPC reservations are invalid");
  validTimestamp(state.createdAt, "state.createdAt");
  validTimestamp(state.updatedAt, "state.updatedAt");
  return state;
}

export function validateBudgetState(config, state) {
  validateBudgetConfig(config);
  validateGenericExistingState(state);
  if (state.periodId !== config.periodId) throw stateError("RPC budget state/config period mismatch");

  const configuredRoles = Object.keys(config.roles).sort();
  const stateRoles = Object.keys(state.roles).sort();
  if (JSON.stringify(configuredRoles) !== JSON.stringify(stateRoles)) throw stateError("RPC budget role set mismatch");
  let roleTotal = 0;
  for (const roleName of configuredRoles) {
    const roleState = state.roles[roleName];
    nonnegativeInteger(roleState.usedCu, `state.roles.${roleName}.usedCu`);
    nonnegativeInteger(roleState.requests, `state.roles.${roleName}.requests`);
    if (roleState.usedCu > config.roles[roleName].capCu) throw stateError(`RPC role ${roleName} exceeds configured cap`);
    roleTotal += roleState.usedCu;
  }
  if (!Number.isSafeInteger(roleTotal) || roleTotal !== state.usedCu) {
    throw stateError("RPC budget account and role counters disagree");
  }
  if (state.usedCu > config.accountCapCu) throw stateError("RPC account usage exceeds configured cap");
  if (state.latched && !state.latchReason) throw stateError("Latched RPC budget has no reason");
  if (!state.latched && state.latchReason) throw stateError("Unlatched RPC budget retains a latch reason");
  if (state.reservations.length > 1000) throw stateError("RPC reservation history exceeds bound");

  const retainedCost = Object.fromEntries(configuredRoles.map((role) => [role, 0]));
  const retainedRequests = Object.fromEntries(configuredRoles.map((role) => [role, 0]));
  const reservationIds = new Set();
  for (const [index, reservation] of state.reservations.entries()) {
    const prefix = `state.reservations.${index}`;
    if (!reservation || typeof reservation.id !== "string" || !reservation.id || reservationIds.has(reservation.id)) {
      throw stateError(`Invalid ${prefix}.id`);
    }
    reservationIds.add(reservation.id);
    if (!config.roles[reservation.role]) throw stateError(`Invalid ${prefix}.role`);
    positiveInteger(reservation.costCu, `${prefix}.costCu`);
    validTimestamp(reservation.reservedAt, `${prefix}.reservedAt`);
    if (!reservation.methods || typeof reservation.methods !== "object" || Array.isArray(reservation.methods)) {
      throw stateError(`Invalid ${prefix}.methods`);
    }
    let requestCount = 0;
    let expectedCost = 0;
    for (const [method, count] of Object.entries(reservation.methods)) {
      positiveInteger(count, `${prefix}.methods.${method}`);
      if (!config.roles[reservation.role].methods.includes(method)) throw stateError(`Denied method in ${prefix}: ${method}`);
      requestCount += count;
      expectedCost += config.methodCosts[method] * count;
    }
    if (!Number.isSafeInteger(expectedCost) || requestCount < 1 || expectedCost !== reservation.costCu) {
      throw stateError(`Reservation accounting mismatch at ${prefix}`);
    }
    retainedCost[reservation.role] += reservation.costCu;
    retainedRequests[reservation.role] += requestCount;
  }
  for (const roleName of configuredRoles) {
    if (retainedCost[roleName] > state.roles[roleName].usedCu) throw stateError(`Retained ${roleName} reservations exceed usage`);
    if (retainedRequests[roleName] > state.roles[roleName].requests) throw stateError(`Retained ${roleName} requests exceed count`);
  }
  return state;
}

export function withBudgetLock(stateFile, operation) {
  const lockFile = `${stateFile}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  let handle;
  try {
    handle = fs.openSync(lockFile, "wx", 0o600);
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    fs.fsyncSync(handle);
  } catch (cause) {
    if (handle !== undefined) fs.closeSync(handle);
    const error = new Error("RPC budget lock is unavailable; refusing paid request", { cause });
    error.code = "RPC_BUDGET_LOCKED";
    throw error;
  }
  try {
    return operation();
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lockFile);
  }
}

export function initializeBudgetState(configFile, stateFile, { replace = false, expectedHash = "" } = {}) {
  const config = validateBudgetConfig(readJsonStrict(configFile, "RPC budget config"));
  return withBudgetLock(stateFile, () => {
    const exists = fs.existsSync(stateFile);
    if (exists && !replace) throw stateError("RPC budget state already exists");
    if (exists && replace) {
      const current = validateGenericExistingState(readJsonStrict(stateFile, "RPC budget state"));
      if (!expectedHash || stateHash(current) !== expectedHash) throw stateError("RPC budget state hash mismatch");
      if (current.periodId === config.periodId) throw stateError("Refusing to reset the active RPC billing period");
    }
    const state = initialBudgetState(config);
    durableWrite(stateFile, state);
    return state;
  });
}

export class BudgetLedger {
  constructor({ configFile, stateFile, expectedConfigHash = "" }) {
    this.configFile = configFile;
    this.stateFile = stateFile;
    const configBytes = fs.readFileSync(configFile);
    this.configHash = "0x" + createHash("sha256").update(configBytes).digest("hex");
    if (expectedConfigHash && this.configHash !== expectedConfigHash.toLowerCase()) {
      throw stateError("RPC budget config hash mismatch");
    }
    this.config = validateBudgetConfig(JSON.parse(configBytes.toString("utf8")));
    this.snapshot();
  }

  #withLock(operation) {
    return withBudgetLock(this.stateFile, operation);
  }

  #readState() {
    return validateBudgetState(this.config, readJsonStrict(this.stateFile, "RPC budget state"));
  }

  snapshot() {
    const state = this.#readState();
    return { ...structuredClone(state), stateHash: stateHash(state), configHash: this.configHash };
  }

  estimate(roleName, payload) {
    const role = this.config.roles[roleName];
    if (!role) throw Object.assign(new Error(`Unknown RPC budget role: ${roleName}`), { code: "RPC_ROLE_DENIED" });
    const requests = Array.isArray(payload) ? payload : [payload];
    if (requests.length === 0 || requests.length > this.config.maxBatchItems) {
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
      if (!Number.isSafeInteger(cost) || cost < 1) {
        throw Object.assign(new Error(`No conservative cost configured for ${method}`), { code: "RPC_METHOD_DENIED" });
      }
      costCu += cost;
      methods[method] = (methods[method] || 0) + 1;
    }
    if (!Number.isSafeInteger(costCu)) throw Object.assign(new Error("RPC request cost overflow"), { code: "RPC_METHOD_DENIED" });
    return { role, requests, costCu, methods };
  }

  reserve(roleName, payload) {
    const estimate = this.estimate(roleName, payload);
    return this.#withLock(() => {
      const state = this.#readState();
      if (state.latched) throw Object.assign(new Error(`RPC budget latched: ${state.latchReason}`), { code: "RPC_BUDGET_LATCHED" });
      const roleState = state.roles[roleName];
      if (!roleState) throw stateError("RPC role state missing");
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
      validateBudgetState(this.config, state);
      durableWrite(this.stateFile, state);
      return reservation;
    });
  }

  latch(reason) {
    return this.#withLock(() => {
      const state = this.#readState();
      state.latched = true;
      state.latchReason = String(reason).slice(0, 300) || "unspecified paid RPC incident";
      state.updatedAt = new Date().toISOString();
      validateBudgetState(this.config, state);
      durableWrite(this.stateFile, state);
      return { ...structuredClone(state), stateHash: stateHash(state), configHash: this.configHash };
    });
  }

  unlatch(expectedHash) {
    return this.#withLock(() => {
      const state = this.#readState();
      if (!expectedHash || stateHash(state) !== expectedHash) throw stateError("RPC budget state hash mismatch");
      if (!state.latched) throw stateError("RPC budget is not latched; refusing redundant unlatch");
      state.latched = false;
      state.latchReason = "";
      state.updatedAt = new Date().toISOString();
      validateBudgetState(this.config, state);
      durableWrite(this.stateFile, state);
      return { ...structuredClone(state), stateHash: stateHash(state), configHash: this.configHash };
    });
  }
}
