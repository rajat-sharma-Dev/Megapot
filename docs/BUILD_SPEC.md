# RALLY VAULT — v2 Build Spec

### Megapot Prize Track · Summer Game Jam 2026

> **Supersedes** `Rally_Vault_Game_Design_Build_Doc.md`. The game concept is unchanged — 5-player randomized obstacle race, Shards, steals, Golden Jackpot Orb, Point Bank, Cookie. What changed is the Megapot integration, which was written against an API that no longer exists, and the schedule, which was one day per day too optimistic.
>
> **All contract addresses, function signatures and protocol constants below were verified live against `llms.megapot.io` and `api.megapot.io/v1` on 8 August 2026.** Where the old doc said "verify this before coding" — this is that verification.

---

## 0. Timeline Reality Check

| | |
|---|---|
| **Today** | Saturday 8 August 2026 |
| **Deadline** | Friday 14 August 2026, 6:00 PM EDT |
| **Actual runway** | **6 days**, not 8 |
| **Target submit** | Friday 14 August, ~2:00 PM EDT (4h buffer) |

The old doc's 8-day plan assumed a 6 Aug start. Section 12 is re-cut for 6 days, and the ordering changed: **the on-chain purchase flow is built on Day 1, before any game code.** It is 30% of the score and it is the thing most likely to fail silently at 4 AM on the 14th.

---

## 1. The Game in One Paragraph

Rally Vault is a 5-player obstacle race on a track generated randomly from scratch every time, so nobody can memorize a route — it's always live skill. While racing you collect **numbered Shards**, and the numbers you pick up literally become the numbers on a real Megapot lottery ticket. A **Golden Jackpot Orb** appears unpredictably on some races; whoever grabs it claims the **bonusball**. Points accumulate into a permanent Point Bank, and when it crosses the threshold the game buys you a real $1 Megapot ticket on Base — carrying the numbers you earned on the track — delivered as an NFT straight to your wallet.

That one change — **the ticket's numbers are earned in the race** — is the difference between "a game that calls a lottery API" and "a game where playing *is* filling out the lottery ticket." Everything else in this spec is in service of it.

---

## 2. Core Loop

```
Join a 5-player race → Race a random track (60–90 sec) →
Collect numbered Shards (→ your 5 normals)
  · steal from rivals · chase the Orb (→ your bonusball) →
Finish → Points + numbers locked into your Point Bank →
Threshold crossed → Real Megapot ticket minted to your wallet
  with YOUR numbers → Daily 17:00 UTC draw → Repeat
```

---

## 3. DECISIONS LOCKED

The four open questions are decided. Rationale for each, so they can be re-argued if a playtest disagrees.

### 3.1 Numbered Shards — **YES, this is the headline feature**

Megapot tickets are Powerball-style: **5 unique normals in `[1, ballMax]` ascending, plus 1 bonusball in `[1, bonusballMax]`**. Live values today are `ballMax = 30`, `bonusballMax = 10`, but these are per-drawing state and **must be read live, never hardcoded**.

The mapping:

| In-game | On-ticket |
|---|---|
| 6–8 numbered Shards on the track, values drawn from `[1, ballMax]` | The **first 5 unique** Shards you collect become your normals (sorted ascending at submit time) |
| Golden Jackpot Orb | Your **bonusball**, value in `[1, bonusballMax]` |
| Collected fewer than 5 Shards | Missing slots auto-filled randomly — shown explicitly in the UI as "3 earned, 2 random" |
| Never grabbed an Orb | Bonusball auto-filled randomly |

**Why this wins.** The judging rubric weights Megapot integration depth at 30%, judged by the protocol's own team. Under the old design the lottery ticket was an opaque payout — the game could have awarded a gift card and nothing would change. Under this design the ticket cannot exist without someone having played the race. It also fixes a real weakness in the original: the Golden Orb was worth 80–120 points, which is just "a big Shard." Making it the bonusball gives it a distinct identity and makes the roll-over drama land — *the bonusball nobody claimed is still out there.*

**Cost:** roughly half a day. A Shard already has a position and a value; we add an integer and a collection-order rule.

**Guard rails.** Ball ranges are read from `getDrawingState(currentDrawingId)` at race-generation time and stamped into the race seed record, so a race generated just before a drawing rollover can't produce numbers that are invalid by the time the ticket is bought. If the range shrinks between race and purchase, out-of-range numbers are re-rolled and the UI says so.

### 3.2 Multiplayer — **Seeded-async, committed**

Everyone in a lobby races the same seed; results are compared on completion. Rivals render as ghosts from their live-or-recorded position stream.

Real-time authoritative netcode for 5 players in 6 days is the single largest schedule risk in this project, and the old doc's own contingency section already named it. A demo video cannot tell the difference — five racers appear on the same track, positions update, someone wins. Committing now instead of on Day 4 saves the scramble.

**Steals under async:** a steal fires when you cross a Steal Zone checkpoint ahead of a rival's ghost at that same checkpoint. Deterministic, replayable, no rollback netcode, and it reads identically on screen.

Live sockets stay on the stretch list. They are not in v1.

### 3.3 Loadouts — **CUT**

The old doc named them first-to-cut. Cutting now rather than on Day 4 saves the decision cost. Post-jam feature.

### 3.4 Stack — **Fork the starter kit's contract layer, build the app in Next.js**

The official starter kit (`coordinationlabs/megapot-starter-kit`) is React + wagmi + Vite. We take its **hooks, ABIs and Data API client** — the parts that encode correct protocol usage — and build the app itself in Next.js, because we need server-side route handlers for the treasury purchase job.

**This is non-negotiable for security:** the treasury private key that pays for tickets must never reach the browser. Ticket purchases are triggered by a server route that independently recomputes the player's Point Bank from stored race results. A client that can ask for a ticket is a client that can mint infinite tickets.

### 3.5 Testnet first — **Base Sepolia on Day 1, mainnet on Day 2**

The old doc went straight to mainnet with a funded treasury. Megapot has a **full testnet deployment on Base Sepolia**, so the entire purchase flow can be built and hammered with free USDC before a real dollar is spent. Mainnet is a config flip.

---

## 4. Megapot Integration — Verified

### 4.1 Contract addresses

| Contract | Base Mainnet (8453) | Base Sepolia (84532) |
|---|---|---|
| **Jackpot** | `0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2` | `0x465dA3c859f193A3807386387bEE941B2A4c3279` |
| **JackpotRandomTicketBuyer** | `0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd` | `0x53c04e7e5044B28Ea8A4F9c4b26E3Ac1aeb63746` |
| **JackpotTicketNFT** | `0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4` | `0x45084829ac63f9dC6a3D4981A46FA896f9180ECd` |
| **BatchPurchaseFacilitator** | `0xBA343479D98a1Ed333899999D95a7343B808a76F` | `0x62A5D60F486D01a28071652a7951Aff1EA4c5b7c` |
| **USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Full 13-contract index: `https://llms.megapot.io/abi/index.json`. ABIs: `https://llms.megapot.io/abi/<Name>.json` (or `.txt` for `parseAbi` form).

> ⚠️ The address in the old doc (`0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95`) is **stale and must not be used.**

### 4.2 The call we make

`purchaseTickets(address, uint256, address)` from the old doc **does not exist.** The current signature, verified from the live ABI:

```solidity
// Jackpot — player-chosen numbers, 1–10 tickets. THIS IS OUR PRIMARY CALL.
function buyTickets(
    (uint8[] normals, uint8 bonusball)[] _tickets,
    address _recipient,
    address[] _referrers,
    uint256[] _referralSplit,
    bytes32 _source
) returns (uint256[] ticketIds)
```

`_recipient` is what makes the whole design work: **our treasury pays the USDC, the ticket NFT lands in the player's wallet.**

Fallback for the "player collected no Shards" edge case, and a useful smoke test:

```solidity
// JackpotRandomTicketBuyer — protocol-generated numbers
function buyTickets(
    uint256 _count, address _recipient,
    address[] _referrers, uint256[] _referralSplitBps, bytes32 _source
) returns (uint256[] ticketIds)
```

### 4.3 Validation rules — enforce these client-side before spending gas

- `normals`: exactly **5**, **unique**, **ascending**, each in `[1, ballMax]`
- `bonusball`: **non-zero**, in `[1, bonusballMax]`
- `ballMax` / `bonusballMax` come from `getDrawingState(currentDrawingId)`, **not** from the protocol-level `normalBallMax()` constant
- USDC approval to the Jackpot contract for `ticketPrice * count` must land **before** the buy
- Reverts to handle by name: `InvalidBonusball`, `ReferralSplitSumInvalid`, `ReferralSplitLengthMismatch`, `InvalidTicketCount`, `InvalidRecipient`

### 4.4 Referrals — two revenue streams, not one

The old doc described a flat 10% referrer param. Current reality:

```ts
_referrers:     [OUR_TREASURY_ADDRESS]        // up to 5 addresses
_referralSplit: [1000000000000000000n]        // 1e18 scale, MUST sum to exactly 1e18
```

Not basis points despite the `Bps` name on the random buyer. Two earnings streams, both readable from `getDrawingState()`:

- `referralFee` — a cut of ticket price, accrued at purchase
- `referralWinShare` — a cut of the player's winnings, if they win

Accrued fees are withdrawn with `claimReferralFees()`. Worth a line in the README: it shows we read the protocol rather than skimmed it.

### 4.5 Reading state

```ts
const drawingId = await jackpot.read.currentDrawingId()
const s = await jackpot.read.getDrawingState([drawingId])
// → { prizePool, ticketPrice, edgePerTicket, referralWinShare, referralFee,
//     globalTicketsBought, lpEarnings, drawingTime, winningTicket,
//     ballMax, bonusballMax, payoutCalculator, jackpotLock }
```

`jackpotLock == true` means settlement is in progress — **queue purchases, don't attempt them.** This is a real failure mode during a live demo and the old doc had no concept of it.

### 4.6 Data API

Base `https://api.megapot.io/v1` · testnet `https://api-testnet.megapot.io/v1`. No API key needed (anonymous 120 req/min; keyed 300).

| Endpoint | Used for |
|---|---|
| `GET /rounds/active` | Home ticker: live prize pool, ball ranges, draw close time |
| `GET /wallets/{addr}/tickets` | Profile: the player's real tickets |
| `GET /wallets/{addr}/wins` | Win notification banner |
| `GET /wallets/{addr}/stats` | Lifetime stats on profile |
| `GET /rounds/latest-settled` | "Last draw's numbers" widget |

Amounts are `{ amount: "1103242344621", decimals: 6 }` — integer strings in smallest units. **Never parse as float.**

**Live as of writing:** round 137, prize pool **$1,103,242.34**, 1,473 tickets, 248 participants, normals 1–30, bonusball 1–10, draws daily at **17:00 UTC**.

### 4.7 Tickets are ERC-721 — the old doc's open question, answered

`JackpotTicketNFT` mints each ticket as a real NFT; it is burned on claim. The player owns a transferable on-chain object showing the numbers they earned racing. This makes the Results screen genuinely good: show the minted NFT, the numbers, the Basescan link. `TicketNFTArt` renders on-chain art.

### 4.8 The daily draw is a retention mechanic, not a footnote

One drawing per day at 17:00 UTC. That is a natural session boundary the old doc never used: **"the draw closes in 4h 12m — earn a ticket before it does."** A countdown on the Hub converts the protocol's cadence into a reason to play now. Cheap to build, and it speaks directly to the 20% retention criterion.

---

## 5. Race Structure

Unchanged from the original except where noted.

### 5.1 Track

5–6 Sections chained from a pool of ~15–20 templates, no repeats within a race, each with randomized parameters within tested min/max bounds. One server-generated seed per race → every client renders an identical track.

| Section | Tests |
|---|---|
| Zigzag Blade Corridor | Timing, reflexes |
| Rotating Gate Maze | Pattern reading |
| Collapsing Platform Bridge | Speed under pressure |
| Moving Wall Squeeze | Spatial judgment |
| Spike Floor Sprint | Risk vs. caution |

**v1 scope:** ship **8 section templates**, not 20. Randomized parameters do most of the "feels different every time" work; template count is the cheapest thing to add on Day 6 if there's slack.

### 5.2 Barriers

Soft (slow/detour) · Hard (blades, spikes, knockback) · Interactive (trigger against a rival) · Score Traps (max 1 per race).

**Changed:** a Score Trap now looks like a Shard but carries a **duplicate** of a number you already hold — so it costs you a wasted pick slot, not just points. Punishes greed in the currency the game actually runs on.

### 5.3 Shards

6–8 per race in randomized valid positions. **5 points each.** Each carries a number in `[1, ballMax]`. The set on a track is generated to contain **at least 5 distinct values**, so a perfect run always yields a complete ticket. Riskier positions near hard barriers hold no more points — the risk/reward is now about *which numbers* are reachable, which is more interesting than "more points over there."

### 5.4 Golden Jackpot Orb

Spawns on ~40% of races, at a random section and random moment. Worth **80–120 points and the bonusball**. Unclaimed → rolls over and stacks into the next race.

This is the demo video's opening shot.

### 5.5 Steal Zones

At designated checkpoints only. Overtaking a rival's ghost there steals points. Max 2 steals/race/player, up to 25 points each.

**Steals never take numbers.** Tested that idea and rejected it: losing an earned number to a rival feels punitive rather than competitive, and it makes a ticket's contents depend on someone else's skill. Points are the contested currency; numbers are yours once collected.

---

## 6. Point Economy

Retained from the original — the math was sound and tuned to a real session length.

| Source | Points |
|---|---|
| Finish bonus (everyone) | **20** |
| Shards (~4–5 of 6–8) | **~20–25** |
| Clean-Run Bonus (no hard hits) | **15** |
| Near-miss / stylish play | **~5** |
| Steal net gain | **~10 avg** (max 50) |
| Podium | 1st **60** · 2nd **35** · 3rd **20** · 4th–5th **5** |
| Golden Orb | **80–120** |

Mid-skill average **95–110/race**; strong players **130–150**.

**Threshold: 600 points = 1 ticket.** Casual ~6 races (~8 min) · strong ~4–5 · rough ~9–10.

**Cookie path retained as specified:** 1 piece per 3 races completed, 6 pieces = 18 races ≈ 4 sessions → 1 guaranteed ticket. It is deliberately slower than the skill path because it is a floor, not a competitor.

**One addition:** the Cookie ticket uses **random numbers** (via `JackpotRandomTicketBuyer`), while the Point Bank ticket uses **earned numbers**. This gives the two paths distinct on-chain character and makes "earned numbers" feel like the premium outcome without nerfing the guaranteed path.

---

## 7. Screens

1. **Hub** — wallet connect, Quick Match / Private Lobby, live jackpot ticker, **draw countdown**, Point Bank bar, Cookie progress
2. **Lobby** — 5 slots, ready-up, room code, bot-fill after 15s
3. **Race HUD** — timer, position, points, **collected number strip (`[7][14][—][—][—] ✦?`)**, steal flash, Orb alert
4. **Results** — placement, points breakdown, **your ticket numbers as earned**, Point Bank bar, Cookie pieces, and on a ticket mint: the NFT + tx hash + Basescan link
5. **Profile** — address, real tickets from the Data API, tx links tagged by path (Point Bank / Cookie), lifetime stats
6. **Leaderboard** — daily/weekly/all-time + "Most Feared Racer" (points stolen)

The number strip on the HUD is the cheapest, highest-leverage UI in the build: it makes the Megapot integration *visible during gameplay* rather than only at payout. A judge watching the demo sees the lottery ticket filling up in real time.

---

## 8. Stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 15** (App Router) — server routes needed for treasury |
| Rendering | **PixiJS** 2D |
| Wallet | **Privy** embedded wallets (email/social → auto-wallet), external wallets supported |
| Chain | **viem** + **wagmi** |
| DB | **Supabase** (Postgres) |
| Chain target | **Base Sepolia** → **Base Mainnet** on Day 2 |
| Reference | `coordinationlabs/megapot-starter-kit`, `llms.megapot.io` |

**Treasury key lives in a server-only env var.** Purchase route recomputes the Point Bank from stored race results; it never trusts a client-submitted score. Idempotency key per (player, threshold-crossing) so a retry can't double-buy.

---

## 9. Build Order — 6 Days

| Day | Deliverable |
|---|---|
| **Sat 8** | Scaffold. Contract layer + ABIs. **Buy a real ticket with chosen numbers for a second wallet on Base Sepolia, end to end.** Prove the money path before writing game code. |
| **Sun 9** | Race prototype: seeded generator, 8 sections, barriers, numbered Shards, finish. **Playtest that it's fun with zero blockchain attached.** |
| **Mon 10** | Supabase, Privy auth, Point Bank, server purchase route wired to the real contract. Hub with live ticker + draw countdown. **Flip to mainnet, buy one real $1 ticket, verify on Basescan.** |
| **Tue 11** | Seeded-async multiplayer, ghosts, Steal Zones, podium, bot-fill. |
| **Wed 12** | Golden Orb + bonusball binding. Results screen with NFT + tx. Cookie. Leaderboard. |
| **Thu 13** | Polish, deploy public, bug bash, seed leaderboard data, write README integration write-up. |
| **Fri 14** | Demo video, final checks, **submit ~2 PM EDT.** |

**Cut order if behind:** Community Vault (not started) → leaderboard tiers (all-time only) → Cookie → section templates down to 5 → Interactive Barriers. **Never cut the purchase flow or the numbered Shards** — those are the 30%.

---

## 10. Stretch — Community Vault

Shared meter of everyone's points in a window; hitting target auto-buys a **batch of tickets via `BatchPurchaseFacilitator`** (built exactly for 11+ ticket orders) split among contributors. This is Megapot's own stated example of what they want. **Do not start before the core loop and ticket flow both work end to end.**

---

## 11. Repo Structure

```
/rally-vault
├── README.md                       # Pitch + Megapot integration write-up (judged)
├── /app                            # Next.js App Router
│   ├── /(game)                     # hub, lobby, race, results
│   ├── /profile /leaderboard
│   └── /api
│       ├── /race                   # seed gen, result submission
│       └── /tickets/purchase       # SERVER ONLY — treasury signs here
├── /game                           # PixiJS: track generator, sections, entities
├── /lib
│   ├── /megapot                    # addresses, ABIs, buyTickets, drawing state, Data API
│   ├── /points                     # authoritative Point Bank + Cookie math
│   └── /supabase
├── /docs/megapot-integration.md    # deep write-up for the 30%
└── .env.example                    # TREASURY_PRIVATE_KEY is server-only
```

---

## 12. Compliance Note

The game awards real lottery tickets. A short age/jurisdiction gate and a line in the README costs an hour and its absence is more noticeable to a funded lottery protocol's judges than its presence. Not optional.

---

*Verified against `llms.megapot.io`, `api.megapot.io/v1` and the live `Jackpot` ABI on 8 August 2026. Protocol constants (`ballMax`, `bonusballMax`, `ticketPrice`) are per-drawing state and are read at runtime — never hardcoded — because they can change between drawings.*
