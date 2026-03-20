# BTC Signal Dash — Session Log

> **Purpose:** Full-fidelity session continuity. Read this at the start of every new session BEFORE doing anything else.
> **Updated:** 2026-03-21

---

## Role
Claude is PM. Does not write code. Directs the builder, reviews checkpoints, makes go/no-go decisions.

---

## Project State (2026-03-21)

**Status:** Single-file MVP built (`src/index.ts`) with dashboard at `http://localhost:8787` (requires `DASHBOARD=1 npm run dev` from `btc-signal-dash/` in WSL).

**All requested amendments applied** for So What OpenClaw migration. TypeScript build passes.

---

## Critical Bug Status

### Bug 1 — buildSoWhatPrompt newline escaping
- **File:** `src/index.ts`
- **Fix:** `lines.join('\n')` rendered correctly (escaped for client JS string)
- **Status:** ✅ Fixed in HEAD

### Bug 2 — breakout timestamp formatter reference
- **File:** `src/index.ts`
- **Fix:** `fmtClock` replaced by `formatHm`
- **Status:** ✅ Fixed in HEAD

---

## So What Button (Current Implementation)

### Endpoint behavior
- Button posts dashboard context to `POST /api/so-what`
- Server uses **OpenClaw CLI bridge** (not OpenAI/Anthropic APIs)

### OpenClaw invocation
- Exact path + runtime:
  - `node /home/c/.npm-global/bin/openclaw agent ...`
- Uses:
  - `--json`
  - `--session-id <openclaw_session_id>`
  - `--timeout <derived from timeout_ms>`
  - `--thinking <thinking level>`
  - `--message <userText>`

### Prompt handling
- `SO_WHAT_SYSTEM_PROMPT` removed from this flow.
- Server sends **userText only** to OpenClaw.

### API response contract
- Success:
  - `{ ok: true, provider: "openclaw", text }`
- Error:
  - `{ ok: false, provider: "openclaw", code, message }`
- Dashboard client rendering updated to:
  - `j.ok ? j.text : (j.message || 'So What unavailable')`

### Error codes used
- `OPENCLAW_OFFLINE`
- `OPENCLAW_TIMEOUT`
- `OPENCLAW_BAD_RESPONSE`
- `OPENCLAW_NOT_CONFIGURED`

---

## Config Notes

`config/default.yaml` includes:

```yaml
so_what:
  provider: openclaw
  timeout_ms: 45000
  openclaw_session_id: ""
  thinking: medium
```

### Required setup before testing So What
`openclaw_session_id` must be set.

Find it with:

```bash
node /home/c/.npm-global/bin/openclaw sessions --json
```

Then paste the active session ID into `config/default.yaml`:

```yaml
so_what:
  openclaw_session_id: "<session-id>"
```

Restart server after updating config.

---

## Env Vars
- `DASHBOARD=1` — enables HTTP server on port 8787
- `DASHBOARD_HOST` — bind host (default `0.0.0.0`)
- `DASHBOARD_PORT` — port (default `8787`)
- `TEST_ALERT=1` — fire a test Telegram alert and exit

> So What no longer uses `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_MODEL`, or `ANTHROPIC_MODEL`.

---

## Known Issues / Next Items (as of 2026-03-21)
- [ ] Visual polish pass (layout density / card balance)
- [ ] Spark chart first-paint UX (seed initial points so charts aren’t empty on first load)

---

## User Preferences
- AEST timezone (Australia/Sydney)
- Prefers dark, dense UI
- Claude is PM only — never edits code directly
