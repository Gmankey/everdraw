#!/usr/bin/env node
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BudgetLedger } from "./paid-egress-ledger.mjs";
import { QualificationAdmissionLedger } from "./qualification-admission-ledger.mjs";

const BODY_LIMIT = Number(process.env.RPC_GATEWAY_BODY_LIMIT_BYTES || "1048576");
const RESPONSE_LIMIT = Number(process.env.RPC_GATEWAY_RESPONSE_LIMIT_BYTES || "4194304");
const TIMEOUT_MS = Number(process.env.RPC_GATEWAY_UPSTREAM_TIMEOUT_MS || "20000");

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > BODY_LIMIT) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function providerQuotaFailure(status, body) {
  const text = String(body).toLowerCase();
  return status === 402 || status === 429
    || text.includes("compute unit") || text.includes("monthly capacity") || text.includes("quota exceeded");
}

async function readResponseBody(response, controller, limit = RESPONSE_LIMIT) {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    controller.abort();
    throw Object.assign(new Error("Upstream response exceeded configured limit"), {
      code: "RPC_UPSTREAM_RESPONSE_TOO_LARGE",
      status: 502,
    });
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        controller.abort();
        throw Object.assign(new Error("Upstream response exceeded configured limit"), {
          code: "RPC_UPSTREAM_RESPONSE_TOO_LARGE",
          status: 502,
        });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

export function validateGatewayTokens(tokens, roleNames) {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) throw new Error("RPC gateway tokens are invalid");
  for (const role of roleNames) {
    if (typeof tokens[role] !== "string" || tokens[role].length < 32) {
      throw new Error(`RPC gateway token is missing or too short for role ${role}`);
    }
  }
}

export function assertSingleWriterLease({ leaseFile, instanceId }) {
  if (!leaseFile || !instanceId) throw new Error("RPC gateway single-writer lease configuration is missing");
  fs.mkdirSync(path.dirname(leaseFile), { recursive: true });
  if (fs.existsSync(leaseFile)) {
    let lease;
    try {
      lease = JSON.parse(fs.readFileSync(leaseFile, "utf8"));
    } catch {
      throw new Error("RPC gateway single-writer lease is corrupt");
    }
    if (lease.version !== 1 || lease.instanceId !== instanceId) {
      throw new Error(`RPC gateway single-writer lease belongs to another instance: ${lease.instanceId || "unknown"}`);
    }
    return lease;
  }
  const lease = { version: 1, instanceId, createdAt: new Date().toISOString() };
  const handle = fs.openSync(leaseFile, "wx", 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify(lease, null, 2) + "\n");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  const directory = fs.openSync(path.dirname(leaseFile), "r");
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
  return lease;
}

export function createGatewayServer({
  upstreamUrl,
  tokens,
  ledger,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  responseLimit = RESPONSE_LIMIT,
  qualificationAdmission,
  qualificationToken = "",
}) {
  if (!upstreamUrl) throw new Error("RPC_PAID_UPSTREAM_URL is required");
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      try {
        const state = ledger.snapshot();
        const qualification = qualificationAdmission?.snapshot();
        return json(res, state.latched ? 503 : 200, {
          ok: !state.latched,
          periodId: state.periodId,
          usedCu: state.usedCu,
          latched: state.latched,
          latchReason: state.latchReason,
          roles: state.roles,
          stateHash: state.stateHash,
          qualification: qualification ? {
            periodId: qualification.periodId,
            providerIdentity: qualification.providerIdentity,
            usedRequests: qualification.usedRequests,
            stateHash: qualification.stateHash,
          } : null,
        });
      } catch (error) {
        return json(res, 503, { ok: false, error: error.code || "RPC_BUDGET_STATE_UNAVAILABLE" });
      }
    }
    if (req.method === "POST" && req.url?.startsWith("/admission/provider-qualification/")) {
      const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!qualificationAdmission || !qualificationToken || !secureEqual(qualificationToken, supplied)) {
        return json(res, 401, { error: "unauthorized" });
      }
      try {
        const payload = JSON.parse(await readBody(req));
        if (req.url === "/admission/provider-qualification/start") {
          return json(res, 200, qualificationAdmission.start(payload));
        }
        if (req.url === "/admission/provider-qualification/reserve") {
          return json(res, 200, qualificationAdmission.reserve(payload.qualificationId, payload.count));
        }
        return json(res, 404, { error: "not found" });
      } catch (error) {
        return json(res, 503, { error: error.code || "RPC_QUALIFICATION_ADMISSION_UNAVAILABLE" });
      }
    }
    const match = req.url?.match(/^\/rpc\/([a-z0-9-]+)$/);
    if (req.method !== "POST" || !match) return json(res, 404, { error: "not found" });
    const role = match[1];
    const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!tokens[role] || !secureEqual(tokens[role], supplied)) return json(res, 401, { error: "unauthorized" });

    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw);
      ledger.reserve(role, payload);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      let responseBody;
      try {
        response = await fetchImpl(upstreamUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw,
          signal: controller.signal,
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          controller.abort();
          throw Object.assign(new Error("Upstream redirect refused"), {
            code: "RPC_UPSTREAM_REDIRECT_DENIED",
            status: 502,
          });
        }
        responseBody = await readResponseBody(response, controller, responseLimit);
      } finally {
        clearTimeout(timer);
      }
      if (providerQuotaFailure(response.status, responseBody)) ledger.latch(`upstream quota/capacity response status=${response.status}`);
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" });
      res.end(responseBody);
    } catch (error) {
      const code = error?.name === "AbortError" ? "RPC_UPSTREAM_TIMEOUT" : (error.code || "RPC_GATEWAY_FAILURE");
      json(res, error.status || 503, { error: code });
    }
  });
}

export function main() {
  const tokens = JSON.parse(process.env.RPC_GATEWAY_TOKENS_JSON || "{}");
  if (!process.env.RPC_BUDGET_CONFIG_SHA256) throw new Error("RPC_BUDGET_CONFIG_SHA256 is required");
  const ledger = new BudgetLedger({
    configFile: process.env.RPC_BUDGET_CONFIG_FILE || "/data/rpc-budget-config.json",
    stateFile: process.env.RPC_BUDGET_STATE_FILE || "/data/rpc-budget-state.json",
    expectedConfigHash: process.env.RPC_BUDGET_CONFIG_SHA256,
  });
  validateGatewayTokens(tokens, Object.keys(ledger.config.roles));
  const qualificationToken = process.env.RPC_QUALIFICATION_ADMISSION_TOKEN || "";
  if (qualificationToken.length < 32) throw new Error("RPC_QUALIFICATION_ADMISSION_TOKEN is missing or too short");
  if (Object.values(tokens).includes(qualificationToken)) throw new Error("Qualification admission token must be distinct from RPC role tokens");
  if (!process.env.RPC_QUALIFICATION_POLICY_SHA256) throw new Error("RPC_QUALIFICATION_POLICY_SHA256 is required");
  const qualificationAdmission = new QualificationAdmissionLedger({
    policyFile: process.env.RPC_QUALIFICATION_POLICY_FILE || "/data/qualification-admission-policy.json",
    stateFile: process.env.RPC_QUALIFICATION_STATE_FILE || "/data/qualification-admission-state.json",
    expectedPolicyHash: process.env.RPC_QUALIFICATION_POLICY_SHA256,
  });
  if (process.env.RPC_GATEWAY_REQUIRE_SINGLE_WRITER === "true") {
    assertSingleWriterLease({
      leaseFile: process.env.RPC_GATEWAY_WRITER_LEASE_FILE || "/data/rpc-gateway-writer.json",
      instanceId: process.env.FLY_MACHINE_ID,
    });
  }
  const server = createGatewayServer({
    upstreamUrl: process.env.RPC_PAID_UPSTREAM_URL,
    tokens,
    ledger,
    qualificationAdmission,
    qualificationToken,
  });
  const port = Number(process.env.PORT || "8080");
  server.listen(port, "0.0.0.0", () => console.log(`paid RPC egress gateway listening on :${port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
