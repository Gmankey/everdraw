# Blog Draft: External Dependency Security

**Working title:** Dependency Risk Is Still Protocol Risk

**Audience:** EverDraw users, Monad builders, auditors, and technically curious DeFi users.

---

## Dependency Risk Is Still Protocol Risk

Most DeFi security conversations still start and end with the smart contract.

That makes sense. The contract is where the funds sit, where the rules are enforced, and where one bad line can become one very expensive headline. Reentrancy, access control, accounting bugs, upgrade keys, bad randomness - these things matter. They always will.

But the longer I build EverDraw, the more obvious another truth becomes: a clean contract is not the same thing as a safe protocol.

Modern DeFi products do not live alone. They depend on RPCs, frontends, DNS, indexers, keepers, wallets, bridges, yield sources, oracle systems, randomness providers, cloud hosts, operators, and admin keys. Some of those dependencies are obvious. Some are invisible until the day they fail. And when they fail, users usually do not care whether the Solidity was technically correct. They care whether their funds are safe, whether the app still works, and whether the team knows what to do next.

That is the part I think the industry still underestimates.

External dependency security is not a side note. It is protocol security.

## The Dependency Stack

EverDraw looks simple from the user's point of view. You deposit MON, the vault converts it to shMON, the yield funds the prize, one winner takes the pot, and everyone else keeps their principal exposure.

That simple loop is intentional. But underneath it is a dependency stack. Some parts can delay the app. Some can mislead users. A few can directly affect whether users recover the value they expect.

The useful way to talk about those dependencies is not "we use X." It is:

- how X can fail;
- what that failure does to EverDraw;
- what we have done about it;
- what risk remains anyway.

So here is the dependency model in roughly the order I care about it.

## 1. shMON

shMON is the biggest dependency because it is where user principal actually lives after deposit.

EverDraw does not hold user deposits as idle MON. The vault deposits MON into shMON, receives shMON shares, and later uses those shares for principal withdrawals and prize claims. That is the product: staking yield funds the prize. It is also the risk: users inherit shMON behavior.

There are a few ways this can fail.

If shMON share value drops because of slashing or an underlying pool loss, EverDraw cannot make the shares worth the original amount of MON. Users still receive their recorded shares, but those shares may redeem for less MON. That is not a UI issue or an indexer issue. That is yield-source risk.

If shMON transfers are paused, blacklisted, or broken, withdrawals and prize claims can revert until shMON recovers. In the current V3 contract, the shMON address is immutable and transfers are direct `shmon.transfer` calls. There is no alternate asset path and no emergency conversion route. If shMON itself is hacked or drained, EverDraw cannot restore principal from inside the vault. That is the catastrophic case.

The mitigation today is mostly policy and honesty. Protocol fees are kept at 0 bps, which removes the worst round-settlement surface: a fee transfer failing inside finalization. Claims and withdrawals are user-initiated, so if shMON has a temporary transfer issue, users can retry once shMON recovers. The next contract version should add graceful-degradation around shMON transfers, especially deferred accounting if a transfer fails.

The uncomfortable truth is still this: EverDraw's no-loss framing depends on shMON remaining solvent and redeemable. The contract can account fairly in shares. It cannot make a broken yield source whole by pretending.

## 2. Pyth Entropy

Pyth Entropy is the randomness dependency. EverDraw V3 uses it to choose winners.

The main risk is not that the operator secretly picks a winner. The winner is driven by an external entropy flow. The realistic failure modes are more specific: Pyth callback does not arrive, the provider refuses or fails to reveal, the Entropy contract migrates, or the configured provider needs to rotate.

If the callback does not arrive, a round can get stuck waiting for randomness. That does not drain funds, but it delays settlement and leaves users waiting. EverDraw mitigates this with a one-hour callback timeout and an emergency settlement path. In that path, the round can be settled with no winner and depositors can recover principal in shMON shares. Nobody gets the prize for that skipped round, but the vault does not sit frozen forever.

If Pyth migrates its Entropy contract or rotates the provider, a fully immutable address would be worse. It could leave a live vault pointed at dead randomness infrastructure. That is why V3 makes `entropy` and `entropyProvider` changeable by the owner, but only through a 24-hour timelock. The queue event is public. Watchers can alert on it. Users have time to see that a randomness dependency is changing before it takes effect.

That design is a tradeoff. Immutability feels cleaner until the immutable thing you rely on goes away. Mutability is dangerous if it is instant and hidden. It becomes acceptable when it is delayed, public, and narrow.

The remaining risk is that Pyth itself is still an external system. EverDraw can detect failure, wait, skip, or migrate. It cannot force a third-party entropy provider to behave.

## 3. Owner Key

The owner key is the most important human dependency.

The owner cannot steal user principal directly. That matters. But the owner does control real protocol levers: fee configuration, keeper authorization, entropy changes, VRF reserve management, pause/unpause, next-round metadata, and ownership transfer.

If the owner key is lost, the protocol keeps running on the current configuration, but recovery becomes difficult. We cannot rotate keepers, update entropy settings, change fees, withdraw VRF reserves, or respond cleanly to a major dependency migration. The system becomes less dangerous, but also less adaptable.

If the owner key is compromised, the attacker still cannot call an admin function that simply drains user deposits. But they can make the protocol worse. They can pause it, set future fees up to the hard cap, add malicious keepers, drain the VRF reserve, or queue a malicious entropy change that becomes active after 24 hours.

The mitigations are structural and operational. Fee changes are capped and snapshotted for future rounds. Entropy changes have a 24-hour delay. Keeper permissions are separate from owner permissions. Governance events need monitoring so unexpected ownership, fee, keeper, pause, entropy, and reserve actions are caught quickly.

Longer term, the owner role should move to a multisig or timelocked Safe. Early-stage speed is useful. It should not become permanent key-person risk dressed up as agility.

## 4. Frontend And DNS

The frontend is not where the funds live, but it is where users decide what to sign.

That makes `everdraw.xyz`, Vercel, and DNS important. If the frontend is down, users lose the easiest interface, but the contracts remain live. If Vercel deploys a bad build, users may see wrong state or broken flows. If DNS or the frontend is hijacked, the risk is worse: users could be shown a fake interface that asks them to sign hostile transactions.

That kind of compromise does not need to break the EverDraw contracts. It only needs to trick a user into signing something that is not EverDraw.

The mitigation is address verification outside the website. Canonical contract addresses, ABIs, constructor arguments, and bytecode references should live in the public GitHub repo and be mirrored through other channels such as Twitter/X, Discord, docs, and block explorers. Users should have more than one place to verify that the contract they are interacting with is the real one.

This is why frontend security is protocol security. A malicious site can hurt users even when the Solidity is perfectly fine. "The contract was safe" is not a satisfying answer to someone who signed through a poisoned interface.

## 5. Keeper

The keeper is the automation that moves rounds forward.

It commits draws, triggers randomness, settles rounds, and calls the convenience flows that keep the product feeling alive. If the keeper goes offline, rounds can stall at the lifecycle stage they reached. That is frustrating and visible, but it is not the same as funds being drained or accounting being corrupted.

The keeper has deliberately limited power. It cannot change fees, change the owner, pause the protocol, update entropy, or withdraw the VRF reserve. If the keeper key is compromised, the blast radius is mostly operational and gas-related. The owner can authorize a new keeper and remove the old one.

The mitigation is redundancy and monitoring. The keeper now runs as always-on infrastructure rather than from a local laptop. It needs funding alerts, health checks, and clear recovery steps. The goal is not to make the keeper magical. The goal is to make keeper failure boring: visible, recoverable, and not fund-threatening.

## 6. Monad L1 And RPC Access

EverDraw depends on Monad itself. That sounds obvious, but obvious dependencies are still dependencies.

If Monad L1 is down, nobody can progress. Users cannot deposit, withdraw, claim, or verify state. There is no protocol-level workaround for base-layer downtime. The honest mitigation is communication and waiting for the chain to recover.

RPC failure is different. If the primary RPC is down but Monad is still producing blocks, the contracts still exist and users can still interact through other routes. Off-chain services may lose visibility, keepers may fail to submit transactions, and the frontend may show stale or missing data.

That is why fallback RPCs matter. The keeper and indexer need backup RPC endpoints, retry logic, and operational runbooks. This is not glamorous security work. It is the kind of plumbing that prevents a perfectly healthy contract from looking broken because one endpoint had a bad day.

The remaining risk is that all RPCs can lag, censor, rate-limit, or disagree temporarily. The chain is the source of truth. RPCs are windows into it, and windows can get dirty.

## 7. Indexer And Historical Data

The indexer makes EverDraw usable. It powers history, wallet positions, round outcomes, and views that would be painful to reconstruct directly in the browser.

If the indexer is down, users may see missing history. If it is behind, the UI may show stale results. If it has a bug, the app can display a wrong interpretation of past events. That can confuse users and operators, even though on-chain state remains unchanged.

The mitigation is to treat the indexer as a cache, not an authority. Critical values should be reproducible from on-chain logs or direct contract reads. The code should be open enough that another operator can rebuild it. User-facing flows should fall back to direct reads where practical.

The indexer does not decide who won. It reports what happened. That distinction matters.

## 8. Cloud Accounts, Alerts, And Operator Process

The last dependency is the least elegant one: process.

Fly.io hosts runtime services. Vercel hosts the frontend. Telegram carries operational alerts. GitHub carries source, deployment records, and public addresses. The operator's devices and accounts hold the access needed to respond when something breaks.

None of these are the protocol contract. All of them affect whether the protocol can be operated responsibly.

If a Fly app dies, the keeper or indexer can stop. If Telegram alerts fail, the operator may miss a low reserve or governance event. If GitHub is stale, users cannot verify addresses confidently. If the operator is incapacitated and no succession plan exists, the protocol may keep running but lose the ability to adapt.

The mitigation is unromantic: runbooks, alerts, backups, public address records, recovery contacts, and eventually multisig operations. This is the part of DeFi that does not fit nicely in a contract audit, but it is where a lot of real-world failure lives.

## The Standard Going Forward

The standard for EverDraw is simple: every meaningful change must name the external systems it touches.

If a frontend change depends on Vercel, DNS, wallet RPCs, or indexer data, say so. If a contract change touches randomness, explain the Pyth failure mode. If a keeper change touches round progression, explain what happens when Fly.io, RPC, Telegram, or the keeper key fails. If a yield-source assumption changes, say whether users can lose value, get stuck, or be misled.

A clean code review is not enough if the dependency model is missing.

Every future vault, campaign, keeper change, indexer change, and frontend release should answer five questions:

- What external systems does this depend on?
- What happens when each one fails?
- Can users lose funds, get stuck, or be misled?
- Is the failure mitigated in code, handled operationally, or accepted as a documented risk?
- What should users or operators do when it happens?

That is not bureaucracy. That is how a small protocol grows up without lying to itself.

Users should not need to read every ADR before depositing. That would be absurd. But users deserve a protocol that has done that work internally. They deserve docs that explain the real assumptions. They deserve public addresses they can verify. They deserve alerts when governance changes happen. They deserve a team that does not hide behind "the contract is fine" when the problem lives one layer outside it.

EverDraw is still early. The product will change, the vaults will improve, and the dependency model will keep getting sharper. But the principle is already set:

Protocol security does not stop at the contract boundary.

It stops where user risk actually stops.
