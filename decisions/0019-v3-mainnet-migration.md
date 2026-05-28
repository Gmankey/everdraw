# ADR-0019 — V3 mainnet migration: replace both V2 vaults with VRF contracts

**Status:** Accepted
**Date:** 2026-05-24
**Deciders:** User + Claude (PM)

## Context

`TicketPrizePoolShmonV3` passed full testnet smoke test on 2026-05-23 at
`0x11c3F083A319aA35a6A5C43AdA2b243db0c06FfB`. ADR-0014 requires VRF before any
public mainnet launch. The two current production vaults run V2 (`TicketPrizePoolShmonV2`,
blockhash randomness). This ADR authorises replacing both with V3 (Pyth Entropy VRF).

### Current production state at time of writing (2026-05-24)

| Role | Address | Status |
|---|---|---|
| Vault A | `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` | Active V2, round 3 open |
| Vault B | `0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d` | Active V2, round 1 just opened (deployed tonight) |
| Legacy Vault B | `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a` | Retiring — round 4 settling ~2026-05-25 |

### Pyth Entropy on Monad mainnet — verified on-chain 2026-05-24

| Field | Value |
|---|---|
| Contract | `0xD458261E832415CFd3BAE5E416FdF3230ce6F134` |
| Default provider | `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506` |
| Fee per request | `0.77 MON` (read from `getFee(defaultProvider)`) |

**Important correction to ADR-0014:** ADR-0014 described the Pyth fee as "negligible." The
actual mainnet fee is 0.77 MON per draw. This is **not** deducted from the prize pool — it is
paid from a separately funded `VRFReserve` balance held by the contract and topped up by the
owner. The prize pool math is unaffected. The fee is an operational cost to the protocol, not
to depositors. At two vaults × one draw per week, the operational cost is ~80 MON/year.

## Decision

Deploy two `TicketPrizePoolShmonV3` contracts — one for each vault role — at their respective
cadence anchors. Replace both V2 vaults in the frontend and keeper immediately after each
deploy. Retire the V2 vaults gracefully (in-flight rounds settle, claims remain accessible).

### Deploy parameters (ADR-0010 cadence invariant applies)

All params below are identical for both V3 contracts except deploy timing.

| Param | Value |
|---|---|
| `shmon` | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` |
| `ticketPriceMON` | `1000000000000000000` (1 MON) |
| `roundDurationSec` | `86400` |
| `yieldPeriodSec` | `518100` |
| `entropy` | `0xD458261E832415CFd3BAE5E416FdF3230ce6F134` |
| `entropyProvider` | `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506` |
| Owner | `0x84875804608467B3577605c0976dC645739091eD` (personal wallet, same as V2) |

### Deploy timing

| Vault | Deploy target | Replaces |
|---|---|---|
| Vault A V3 | **Wed 2026-05-27 13:00 UTC** (deployed 13:25 UTC at `0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee`) | `0x2208…` (V2) |
| Vault B V3 | **Sun 2026-05-31 01:00 UTC** | `0xd4F4286…` (V2) |

> **Correction note (2026-05-28):** the original draft of this ADR listed "Wed 2026-05-28" and "Sun 2026-06-01" — the day names were correct for the intended schedule but the date numbers were one calendar week ahead. Vault A V3 was deployed on its true Wednesday, 2026-05-27. Vault B V3 is scheduled for its true Sunday, 2026-05-31.

Vault B V3 is timed one week after tonight's V2-B deploy so that new Vault B V2 round 1
completes its deposit window before being superseded. No user who deposits into V2-B tonight
will be mid-round when the frontend switches to V3-B.

### VRF reserve seeding (mandatory at each deploy)

Seed **20 MON per vault** immediately after deployment via `depositVRFReserve()`. This covers
~26 weeks (6 months) of draws at the current 0.77 MON/request mainnet fee. Top up when
reserve drops below 5 MON.

```bash
cast send <V3_ADDR> "depositVRFReserve()" \
  --value 20ether \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Sequencing for each vault deploy (repeat for Vault A then Vault B)

1. **Pre-deploy (≥24h before):** confirm V3 source in `src/` matches testnet smoke bytecode.
   Confirm Pyth addresses from the table above match the live contract. Builder ticket cites
   this ADR and ADR-0010 and ADR-0014.

2. **Deploy at anchor.** Use `npm run deploy:mainnet:v3` with env vars:
   ```
   SHMON=0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c
   ENTROPY=0xD458261E832415CFd3BAE5E416FdF3230ce6F134
   ENTROPY_PROVIDER=0x52DeaA1c84233F7bb8C8A45baeDE41091c616506
   TICKET_PRICE_MON=1
   ROUND_DURATION_SEC=86400
   YIELD_PERIOD_SEC=518100
   MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz
   MONAD_MAINNET_CHAIN_ID=143
   ```

3. **Seed VRF reserve: 20 MON** via `depositVRFReserve()`.

4. **Post-deploy verification (blocks promotion):**
   ```bash
   cast call <V3_ADDR> 'roundDurationSec()(uint32)' --rpc-url $RPC_URL  # expect 86400
   cast call <V3_ADDR> 'yieldPeriodSec()(uint32)' --rpc-url $RPC_URL    # expect 518100
   cast call <V3_ADDR> 'ticketPriceMON()(uint96)' --rpc-url $RPC_URL    # expect 1e18
   cast call <V3_ADDR> 'shmon()(address)' --rpc-url $RPC_URL            # expect 0x1B686…
   cast call <V3_ADDR> 'entropy()(address)' --rpc-url $RPC_URL          # expect 0xD458…
   cast call <V3_ADDR> 'entropyProvider()(address)' --rpc-url $RPC_URL  # expect 0x52De…
   cast call <V3_ADDR> 'owner()(address)' --rpc-url $RPC_URL            # expect 0x8487…
   ```

5. **Promote into vault role:**
   - Keeper `keeper-mainnet.env`: add V3 address to `POOL_ADDRESSES` and `POOL_ADDRESSES_V3`,
     add to `POOL_SCHEDULE_V3` with the correct anchor. Retain retiring V2 address in
     `POOL_ADDRESSES` (monitoring only) until all depositors have claimed.
   - Frontend (Vercel): add V3 address to `VITE_POOL_ADDRESSES_V3`. Remove the V2 address
     from `VITE_POOL_ADDRESSES_V2` for this slot.
   - Restart keeper watchdog.

6. **V2 vault retirement:** The replaced V2 vault continues settling in-flight rounds.
   Remove it from `POOL_ADDRESSES` only after all depositors have claimed principal.
   Depositors access their positions via the "My Rounds" view regardless of whether the
   vault is in the active UI rotation.

### Indexer changes required before V3 deploy

V3 emits different event shapes than V2 (VRFRequested, VRFFulfilled, and a different
RoundSettled signature). The indexer ABI and derive services must support V3 events before
the first V3 round settles, or the "see winners" page will regress. Builder ticket required.

### `deploy:mainnet:v3` preflight fix required

The V2 deploy tonight exposed that the preflight blocks non-staging branches and that
`MONAD_MAINNET_CHAIN_ID` is not set in the out-of-repo env. Before Vault A V3 deploy:

- Add `MONAD_MAINNET_CHAIN_ID=143` to `/home/c/.config/everdraw/everdraw-root.env`
- Restore the preflight call in `deploy-ticket-prize-pool-shmon-v2.js` (currently commented out)
- Ensure `deploy-ticket-prize-pool-shmon-v3.js` has the preflight call and that staging is
  the deploy branch, or document the DEPLOY_BRANCH override procedure

## Rationale

- VRF is the audit blocker (ADR-0014). Both vaults must run V3 for the audit finding to close.
  A mixed V2/V3 fleet keeps the `weak-prng` finding open on the V2 vaults.
- Replacing both at their natural weekly anchors means users never see an off-cadence vault.
- VRF reserve funded separately from prize pool — depositors are unaffected by operational cost.
- 20 MON / 6 months runway gives time to observe real mainnet Pyth fee behaviour and adjust.

## Alternatives considered

- **Replace only Vault A, leave Vault B on V2.** Rejected — audit finding stays open on V2-B.
- **Run V3 as a third vault alongside V2.** Rejected — adds UI complexity and contradicts the
  two-vault cadence promise of ADR-0001.
- **Wait until both V2 rounds settle before deploying V3.** Rejected — unnecessary delay.
  V2 rounds settle in background; frontend can point at V3 immediately.

## Consequences

### Builder tickets required (in order)

1. **Indexer V3 event support** — add V3 ABI, normalise VRFRequested/VRFFulfilled/V3-shaped
   RoundSettled. Must land on Fly before first V3 round settles.
2. **Frontend V3 state display** — "Drawing winner…" intermediate state for AwaitingVRF.
   Must land before Vault A V3 deploy (Wed 2026-05-27).
3. **Vault A V3 deploy** — Wed 2026-05-27 13:00 UTC, per sequencing above.
4. **Vault B V3 deploy** — Sun 2026-05-31 01:00 UTC, per sequencing above.
5. **V2 vault retirement** — remove V2 addresses from keeper/frontend after all claims clear.

### Operational

- Owner must monitor VRF reserve balance and top up before it drops below 5 MON.
- Pyth fee may change. Re-read `getFee(provider)` before each deploy rather than relying
  on the 0.77 MON figure above.

### Risk

- Pyth callback timing is seconds-to-minutes. Keeper must handle the async gap between
  `commitDraw` and `finalizeDraw` without assuming immediate settlement.
- VRF callback gas budget: `entropyCallback` must stay lean (verified in smoke test).
- If Pyth provider goes down mid-round, `emergencyForceSettle` after `VRF_CALLBACK_TIMEOUT`
  refunds all principal with `lossRatio = 1e18`. See ADR-0015 for failover playbook.

## Related ADRs

- ADR-0001 — Two-vault staggered cadence (cadence preserved in V3)
- ADR-0010 — Cadence invariant (applies to V3 vaults; `roundDurationSec` and `yieldPeriodSec`
  must match the table in ADR-0010)
- ADR-0014 — VRF as launch requirement; Pyth Entropy as provider
- ADR-0015 — VRF failover playbook
- ADR-0011 — Vault B V2 deploy (contract being superseded by this ADR)
