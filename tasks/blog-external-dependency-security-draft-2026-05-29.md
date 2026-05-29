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

## The Invisible Surface Area

Every DeFi protocol has a dependency graph, whether it admits it or not.

If your app uses a frontend, users depend on the website being real. If it uses an indexer, users depend on off-chain data being accurate. If it uses an oracle, the protocol depends on that oracle's assumptions. If it uses a yield source, users inherit that yield source's risk. If a keeper needs to call a function, rounds can stall when that keeper disappears. If the owner key can change parameters, users are trusting the owner key's custody.

None of this automatically means the protocol is bad. It means the trust model is bigger than the contract.

The real question is whether those dependencies are named, documented, monitored, and handled when they fail.

If they are not, then the protocol is asking users to trust systems they cannot even see.

## What EverDraw Depends On

EverDraw looks simple from the user's point of view. You deposit MON, the vault converts it to shMON, the staking yield funds the prize, one winner takes the pot, and everyone else keeps their principal exposure.

That simple loop is intentional. But underneath it are several external systems that matter.

The first is **shMON**. EverDraw uses shMON as the yield source. That is what makes the product work: deposited MON becomes productive through Monad staking, and that yield becomes the prize. But it also means users inherit shMON risk. If shMON share value falls because of slashing or some underlying loss, EverDraw cannot pretend that did not happen. Users still receive their recorded shares, but those shares may be worth less MON. If shMON transfers were paused, claims and withdrawals could be delayed until transfers resume. If shMON were catastrophically compromised, there is no contract-level magic trick that restores principal from a drained dependency.

That is uncomfortable to write, which is exactly why it needs to be written.

The second dependency is **Pyth Entropy**, which EverDraw V3 uses for verifiable randomness. The design is not "trust the operator to pick a winner." Randomness comes from an external entropy system. Pyth's commit-and-reveal design means the provider cannot wait to see the participants and then choose a favorable value. The realistic failure mode is refusal or failure to reveal. In that case, EverDraw has a one-hour callback timeout and an emergency settlement path: the affected round can be settled with no winner, depositors recover principal in shMON shares, and the protocol moves on.

That is not as exciting as a prize, but it is much better than a stuck vault.

The third dependency is **Monad L1 and RPC access**. If the chain itself is down, nobody can progress. That is base-layer risk. If the primary RPC is down, the contracts still exist, but off-chain systems can lose visibility. The mitigation is boring and necessary: fallback RPCs, retry logic, and operational runbooks.

The fourth dependency is **off-chain infrastructure**. The keeper and indexer run on Fly.io. The frontend runs on Vercel. DNS points users to everdraw.xyz. Those systems do not hold user principal inside the contract, but they shape what users see and what operators can respond to. If the frontend is down, the contracts are still there. If the indexer is stale, history can look wrong. If DNS is hijacked, the danger is more serious: users could be shown a fake interface that asks them to sign hostile transactions.

That last one is the nasty one. A malicious frontend does not need to break the protocol. It only needs to trick users into signing the wrong thing.

## The Lesson From Building EverDraw

The biggest lesson for me has been that dependency failures are not hypothetical paperwork. They change design.

EverDraw V3 made Pyth Entropy mutable behind a 24-hour timelock. At first glance, immutable addresses feel cleaner. But if Pyth ever rotates its Entropy contract or provider, a fully immutable dependency could brick the vault forever and force a new contract deployment. Making that dependency changeable, while forcing a public 24-hour delay, gives users an exit window and gives the protocol a recovery path.

That is the tradeoff: mutability is dangerous if it is instant and hidden. It becomes useful when it is delayed, observable, and bounded.

The shMON dependency led to a different decision. EverDraw V3 keeps protocol fees at zero for now because fee transfer failure would create a worse settlement surface than we are willing to accept. Future contract versions need more graceful handling around shMON transfers before fees should be enabled. That is not a marketing-friendly sentence, but it is the correct one.

The infrastructure dependency led to another set of changes: fallback RPC support, keeper alerts, governance-event monitoring, and canonical contract addresses published outside the main website. None of this changes the core product. It changes the blast radius when something outside the contract goes wrong.

## How We Are Mitigating It

The current EverDraw rule is simple: every meaningful change must name the external systems it touches.

If a PR changes frontend behavior, it needs to say whether it depends on Vercel, DNS, wallet RPCs, or indexer data. If a contract change touches randomness, it needs to explain the Pyth failure mode. If a keeper change touches round progression, it needs to say what happens when Fly.io, RPC, Telegram, or the keeper key fails. A clean code review is not enough if the dependency model is missing.

We are also making canonical addresses easier to verify. Contract addresses, constructor arguments, bytecode hashes, and ABI references live in the public GitHub repo and docs. The plan is to keep those addresses mirrored across GitHub, docs, Twitter/X, and Discord so users have more than one place to verify what they are signing. This matters because website compromise is not the same as contract compromise, but it can still hurt users.

We have also added monitoring around the operations that matter: ownership changes, Pyth entropy changes, keeper changes, fee updates, pause/unpause, VRF reserve withdrawals, emergency settlements, and low reserve warnings. The goal is not to pretend nothing can go wrong. The goal is to know quickly, communicate clearly, and preserve as much user safety as possible.

## Security Is Not Just Prevention

There is a temptation in crypto to talk about security as if it only means prevention.

Prevent the exploit. Prevent the bad call. Prevent the admin from doing something dangerous. Prevent the oracle from being manipulated.

Prevention is ideal, but real systems also need recovery. What happens if the provider goes offline? What happens if the RPC fails? What happens if the operator loses a laptop? What happens if a cloud account gets locked? What happens if the website is down? What happens if the yield source changes behavior?

If the answer is "we will figure it out live," that is not a plan. That is a hope with a keyboard.

For EverDraw, the standard we are moving toward is this: every dependency has a named failure mode, every serious failure mode has either a mitigation or an accepted risk, and accepted risks are written down plainly enough that users and auditors can judge them.

## Why This Matters For Users

Users should not need to read every ADR before depositing. That would be absurd.

But users deserve a protocol that has done that work internally. They deserve docs that explain the real assumptions. They deserve public addresses they can verify. They deserve alerts when governance changes happen. They deserve a team that does not hide behind "the contract is fine" when the problem lives one layer outside it.

EverDraw is built around a simple promise: a chance at meaningful upside without taking the usual destructive bet. To make that credible, the security model has to respect the whole system, not just the Solidity.

That means talking about shMON risk. It means talking about Pyth. It means talking about DNS. It means talking about owner keys, keepers, RPCs, and cloud infrastructure.

Not because any one of those things makes EverDraw uniquely fragile.

Because every real DeFi protocol has dependencies. The honest ones name them.

## The Standard Going Forward

External dependency security will be part of EverDraw's design process from here on out.

Every future vault, campaign, keeper change, indexer change, and frontend release should answer the same basic questions:

- What external systems does this depend on?
- What happens when each one fails?
- Can users lose funds, get stuck, or be misled?
- Is the failure mitigated in code, handled operationally, or accepted as a documented risk?
- What should users or operators do when it happens?

That is not bureaucracy. That is how a small protocol grows up without lying to itself.

EverDraw is still early. The product will change, the vaults will improve, and the dependency model will keep getting sharper. But the principle is already set:

Protocol security does not stop at the contract boundary.

It stops where user risk actually stops.
