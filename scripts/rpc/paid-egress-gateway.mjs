#!/usr/bin/env node
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { BudgetLedger } from "./paid-egress-ledger.mjs";

const BODY_LIMIT = Number(process.env.RPC_GATEWAY_BODY_LIMIT_BYTES || "1048576");
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

export function createGatewayServer({ upstreamUrl, tokens, ledger, fetchImpl = fetch }) {
  if (!upstreamUrl) throw new Error("RPC_PAID_UPSTREAM_URL is required");
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      try {
        const state = ledger.snapshot();
        return json(res, state.latched ? 503 : 200, {
          ok: !state.latched,
          periodId: state.periodId,
          usedCu: state.usedCu,
          latched: state.latched,
          latchReason: state.latchReason,
          roles: state.roles,
          stateHash: state.stateHash,
        });
      } catch (error) {
        return json(res, 503, { ok: false, error: error.code || "RPC_BUDGET_STATE_UNAVAILABLE" });
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
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response;
      try {
        response = await fetchImpl(upstreamUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const responseBody = await response.text();
      if (providerQuotaFailure(response.status, responseBody)) ledger.latch(`upstream quota/capacity response status=${response.status}`);
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" });
      res.end(responseBody);
    } catch (error) {
      json(res, error.status || 503, { error: error.code || "RPC_GATEWAY_FAILURE", message: error.message });
    }
  });
}

export function main() {
  const tokens = JSON.parse(process.env.RPC_GATEWAY_TOKENS_JSON || "{}");
  const ledger = new BudgetLedger({
    configFile: process.env.RPC_BUDGET_CONFIG_FILE || "/data/rpc-budget-config.json",
    stateFile: process.env.RPC_BUDGET_STATE_FILE || "/data/rpc-budget-state.json",
  });
  const server = createGatewayServer({
    upstreamUrl: process.env.RPC_PAID_UPSTREAM_URL,
    tokens,
    ledger,
  });
  const port = Number(process.env.PORT || "8080");
  server.listen(port, "0.0.0.0", () => console.log(`paid RPC egress gateway listening on :${port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
