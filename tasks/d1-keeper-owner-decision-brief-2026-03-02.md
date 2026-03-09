# D1 Decision Brief — Keeper Owner Policy (Gate C)

**Date:** 2026-03-02  
**Project:** Everdraw  
**Decision needed:** Who should be authorized as keeper owner/operator after burn-in?

## Context
- Keeper is permissionless for `executeNext()`, but operationally we run a managed bot wallet.
- Burn-in objective: reliability + alert quality + restart resilience.
- Current status: systemd live, heartbeat/error telemetry enabled, Telegram path validated.

## Options

### Option A — Single hot wallet (current simplest)
**Pros**
- Fastest to operate
- Minimal moving parts

**Cons**
- Key compromise = immediate risk
- No separation between operator and emergency control

**Use if**
- Testnet/early burn-in only

---

### Option B — Dedicated keeper wallet + separate owner wallet (recommended now)
**Pros**
- Clear separation of duties
- Compromised keeper key cannot perform owner-only actions
- Operationally simple

**Cons**
- Slightly more process overhead

**Use if**
- Moving from burn-in to production-readiness

---

### Option C — Multi-keeper redundancy + separate owner wallet (recommended for mainnet)
**Pros**
- Better uptime and failover
- Lower chance of missed draw windows

**Cons**
- More infra complexity (monitoring + duplicate action handling)

**Use if**
- Mainnet with reliability SLO

## Recommendation
- **Gate C (post burn-in): choose Option B**.
- **Mainnet target: evolve to Option C** once ShMonad address (D5) is finalized and deployment window opens.

## Decision checklist for PM
- [ ] Confirm separate owner wallet policy
- [ ] Confirm keeper wallet funding policy + refill threshold
- [ ] Confirm incident rotation policy for compromised keeper key
- [ ] Confirm multi-keeper timeline (pre-mainnet or post-mainnet week 1)

## Acceptance criteria
- Keeper wallet has no owner-only privileges.
- Owner wallet never used in automation scripts.
- Runbook updated with key-rotation and incident response steps.
