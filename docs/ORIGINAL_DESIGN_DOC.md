# RALLY VAULT
### Full Game Design & Build Document — Megapot Prize Track, Summer Game Jam 2026

**⏰ Timeline reality check:** Submission deadline is 14 August 2026, 6:00 PM EDT. As of this doc, that's roughly **8 days**. Every recommendation below is scoped with that in mind — this is a "ship something real" spec, not a "dream big" spec.

---

## 1. The Game in One Paragraph

Rally Vault is a 5-player obstacle race. Every race happens on a track that's randomly generated from scratch, so no one can memorize a route and get an unfair edge — it's always about live skill. While racing, you collect points from treasure, clean play, and finishing position. If you catch up to a rival mid-race, you can steal a slice of their points — so points constantly move between players, not just pile up privately. Occasionally, a **Golden Jackpot Orb** appears somewhere on the track — nobody knows when or where until it lights up — and whoever grabs it gets a big bonus. Every race adds to your permanent Point Bank. Cross the threshold, and the game automatically buys you a real $1 Megapot lottery ticket, sent straight to your wallet, live on Base.

---

## 2. Core Loop (30 seconds to explain to a judge)

```
Join a 5-player race → Race a random track (60–90 sec) →
Collect points, steal from rivals, chase the jackpot orb →
Finish → Points locked into your Point Bank →
Point Bank crosses threshold → Real Megapot ticket bought
automatically → Repeat
```

---

## 3. What's In a Race — Full Structure

### 3.1 Start
- 5 players spawn on a start line simultaneously.
- 3-second countdown, then track opens.
- Loadout chosen pre-race (see 3.6).

### 3.2 The Track — 5 to 6 Sections, Chained Together
Every race stitches together 5–6 **Sections** drawn randomly from a pool of ~15–20 section templates. No two sections repeat in the same race. Examples of section templates:

| Section Type | What It Tests |
|---|---|
| Zigzag Blade Corridor | Timing, reflexes |
| Rotating Gate Maze | Pattern reading |
| Collapsing Platform Bridge | Speed under pressure |
| Moving Wall Squeeze | Spatial judgment |
| Spike Floor Sprint | Risk vs. caution |

Each section also has its **own randomized parameters** every time it's used — barrier timing offsets, gap widths, platform speed, spike intervals — all within safe, tested min/max ranges. So even if "Zigzag Blade Corridor" shows up in two different races, it plays differently both times. This is what actually delivers on "no one can memorize the map," not just shuffling section order.

**How the randomness stays fair for all 5 players:** the server generates one random seed per race and sends it to all clients. Every client renders the exact same track from that seed, so it's fair and synced without needing to stream the whole map over the network.

### 3.3 Barriers (the obstacle layer)
- **Soft Barriers** — slow you down or force a detour (moving walls, slow zones).
- **Hard Barriers** — real punishment for a mistake (blades, spike floors, knockback).
- **Interactive Barriers** — a player can trigger these to hit a rival (swinging hammer, collapse switch).
- **Score Traps** — a fake treasure that looks valuable but costs you points if grabbed. Placed to punish greed, not to trick new players constantly — cap at 1 per race.

### 3.4 Collectibles — "Shards"
- 6–8 Shards scattered per race, placed in randomized valid spots within each section.
- Worth 5 points each.
- Some sit in slightly riskier spots (near a hard barrier) — a deliberate risk/reward choice, not free points.

### 3.5 The Star Feature — Golden Jackpot Orb
- On roughly 40% of races, a single glowing, hard-to-miss orb spawns at one **random section and random moment** during that race — not fixed, not predictable, no way to "know" it's coming.
- Worth 80–120 points to whoever grabs it first — big enough that all 5 players will visibly detour and race for it, creating the game's signature dramatic moment.
- If it goes unclaimed, it **rolls over and stacks** into the next race's jackpot, building hype ("the jackpot's been building for 3 races now...").
- This is the feature to lead your demo video with — it's a live, visible, exciting moment that also directly matches what Megapot's own rules ask for ("new ways to make the jackpot social, competitive or fun").

### 3.6 Loadouts
One passive or active ability per player, chosen before the race (e.g., a short speed burst, a one-time barrier immunity). Keep this simple — 3 to 4 loadouts max for the jam. This is the first thing to cut if time runs short; the race and jackpot mechanics matter far more than ability variety.

### 3.7 Steal Zones
Steals don't happen randomly anywhere on the track — they happen at designated **checkpoints** (narrow bridges, gates) where overtaking a rival is visible and readable. This keeps stealing feeling skillful and fair rather than random or exploitable.

### 3.8 Finish
- Placement 1st–5th is locked in as players cross the line.
- Results screen shows a full points breakdown (see Section 4) and Point Bank progress.

---

## 4. Point System — Reworked Math

You were right that the earlier version needed fixing: 70 points/race with a 1,000-point ticket meant ~14 races to earn one ticket, which is far more than a real player will do in a day. Here's the corrected version, aimed at **a strong session of 4–5 races getting a player close to, or at, one ticket** — not every single time (that would make the game trivial), but often enough to feel achievable and worth returning for tomorrow.

### 4.1 Points per race

| Source | Points | Notes |
|---|---|---|
| Finish bonus (everyone gets this) | **20** | Guaranteed floor — no player leaves a race with zero. |
| Shards collected (avg ~4–5 of 6–8 on track) | **~20–25** | 5 pts each |
| Clean-Run Bonus (no hard barrier hits) | **15** | Achieved by roughly 40% of races for a mid-skill player |
| Near-miss / stylish-play bonus | **~5** | Small, skill-flavored |
| Steal net gain (overtaking rivals) | **~10 avg** | Up to 25 pts per steal, capped at 2 steals/race per player (max 50) |
| **Podium Bonus** | 1st: **60** / 2nd: **35** / 3rd: **20** / 4th–5th: **5 (consolation)** | Never zero, but big gap for placing well |
| Golden Jackpot Orb (when it spawns and you grab it) | **80–120** | ~40% of races spawn one; contested by all 5 players |

**Expected average for a mid-skill, engaged player: roughly 95–110 points per race.**
A player who plays well and lands podium finishes regularly can realistically average **130–150 points per race**.

### 4.2 Ticket threshold

**Set the threshold at 600 points = 1 ticket** (down from 1,000).

| Player type | Points/race | Races for 1 ticket | Real time |
|---|---|---|---|
| Casual/average player | ~100 | ~6 races | ~7–9 min |
| Strong/podium-heavy player | ~140 | ~4–5 races | ~5–7 min |
| Rough session (lots of stolen from, no podium) | ~65 | ~9–10 races | ~12–15 min |

This means **a normal 4–5 race session gets most players either right at or close to a ticket**, and a good session gets there comfortably — which matches how you described real play behavior. The 600-point threshold and the per-source point values above are starting numbers for your build, not fixed forever — tune them in playtesting once you see real session lengths and skill spread.

### 4.3 Why this doesn't collapse into "just buy the $1 ticket instead"
- Buying gets you exactly one ticket and nothing else. Playing gets you the ticket **plus** a shot at Golden Jackpot bonuses, podium bragging rights, and leaderboard standing — none of which are purchasable.
- Skill directly compresses time-to-ticket (4–5 races vs. 9–10) — money can't buy that.
- The core race needs to be fun standing entirely on its own, with zero blockchain attached. Playtest that specifically, before anything else — if the race isn't fun by itself, no point economy will fix it.

### 4.4 The Cookie Win — A Second, Guaranteed Path to a Ticket

Alongside the skill-based Point Bank path above, add a second, simpler path that rewards **consistency** rather than skill. This matters because not every player will land podiums or steal effectively — this path guarantees that showing up regularly still pays off, on its own timeline.

**How it works:**
- Every player has a **Cookie**, split into pieces (recommend **6 pieces** — see note below on why).
- For **every 3 races completed** (any race that's finished, any placement — this is a participation reward, not a skill one), the player earns **1 piece of the Cookie**.
- Once all pieces are collected, the Cookie is "whole" and the player is awarded **1 real Megapot ticket** automatically, exactly like crossing the Point Bank threshold — same `purchaseTickets` call, same on-chain flow.
- The Cookie then resets and a new one starts.

**Why 6 pieces, not 4:** with 6 pieces at 3 races each, a full Cookie takes **18 races**, i.e. roughly 4 sessions of 4–5 races. That deliberately makes it slower than the skill-based Point Bank path (which averages 4–10 races). This is the intent: the Cookie is a **guaranteed backup path**, not a competitor to the main path — a player having a rough run of luck or skill still knows a ticket is coming eventually, no RNG or opponents involved, just showing up. If you want a faster, more central path instead of a backup, 4 pieces (12 races) is the alternative — just be aware it then overlaps closely with the Point Bank path's pace and does less to serve a distinct purpose.

**Why this is good design, not redundant with the Point Bank:**
- Point Bank path = rewards skill and aggression (steals, podiums, jackpot grabs) → faster for good players.
- Cookie path = rewards showing up → same eventual outcome for everyone, regardless of skill, on a predictable schedule.
- Together, a skilled player is usually earning tickets from Point Bank *and* slowly filling a Cookie in the background as a bonus; a newer/casual player who isn't winning much still has a clear, honest reason to keep playing.

**UI treatment:** show the Cookie as a simple filling icon (e.g., on the Results screen and Profile page) — "2 of 6 pieces" — with a small celebratory animation when a piece is earned, and a bigger one when the Cookie completes and a ticket is minted. This is cheap to build (just a counter + an icon state) and adds a second visible reason to keep playing beyond the main Point Bank bar.

---

## 5. Room Creation

### 5.1 Quick Match (strangers)
- Player hits "Quick Match," enters a matchmaking queue.
- Fills a 5-player lobby, max wait ~15 seconds.
- **Build note:** during judging you may not have 5 concurrent testers. Fill empty slots with bot racers (simple AI following the same track logic) after the wait cap, so the demo never stalls waiting for real players. This is a practical necessity, not a nice-to-have.

### 5.2 Private Lobby (friends)
- Host creates a room, gets a shareable invite link/code.
- Up to 5 friends join.
- Same race/points/jackpot system as Quick Match — no separate ruleset needed for the jam version (a "Friendly mode" with reduced steal intensity is a good post-jam addition, not a v1 requirement).

---

## 6. Wallet & Player Identity

- Use an embedded-wallet onboarding flow (e.g., Privy or Coinbase Smart Wallet) so a brand-new player can start playing with just an email/social login — a wallet is created for them automatically behind the scenes. This mirrors how Megapot's own account system already <cite index="5-1">creates a wallet automatically if the player doesn't have one when signing in</cite>, so it's a proven pattern for this exact audience.
- Players who already have MetaMask/Coinbase Wallet/Rainbow can connect directly instead.
- Wallet/Profile screen shows: wallet address, current Point Bank + progress bar to next ticket, owned tickets with transaction links, and the live current jackpot size pulled from Megapot's data.

---

## 7. Leaderboard

- **Daily / Weekly / All-Time** leaderboard ranked by Point Bank earned.
- **"Most Feared Racer"** — a secondary leaderboard by total points stolen from rivals, purely for competitive flavor.
- **Community Jackpot Tracker** (optional stretch feature, see Section 9) — a shared bar showing collective progress toward a bonus community ticket batch.

---

## 8. Megapot Integration — What the Hackathon Actually Requires

Per the official rules, your submission needs:
- A working, publicly accessible prototype.
- A **functional Megapot integration on Base**.
- Megapot **incorporated into the main user loop** (not a link-out).
- A public repo, or a detailed integration write-up if proprietary.

Judging weights: **Depth of Megapot integration (30%)**, Gameplay/originality (25%), Working product/UX (25%), Potential to attract/retain users (20%).

Given that 30%+25% split, the on-chain flow working cleanly in the demo matters more than any single gameplay feature. Concretely, you need:

1. **`purchaseTickets(address referrer, uint256 value, address recipient)`** called from your backend/operator wallet whenever a player's Point Bank crosses 600 points. Confirmed signature: <cite index="10-1">Purchases tickets for a given recipient; the value must be increments of the ticketPrice.</cite> Ticket pricing is confirmed in USDC's 6-decimal units: <cite index="14-1">value is the number of tickets to purchase, in szabo, where 1,000,000 szabo equals 1 ticket</cite> ($1 USDC).
2. **A funded operator/treasury wallet** holding USDC on Base, since your app pays for the ticket, not the player directly. Budget for this explicitly for the demo (even $20–50 in USDC covers a lot of test tickets).
3. **Referral parameter set to your project's own wallet** — this earns your project 10% back on every ticket purchased, per <cite index="14-1">the referrer parameter, which triggers the contract to pay 10% of the ticket price for each ticket purchased</cite>. Small but free, and shows judges you understand the protocol.
4. **Live jackpot data displayed in-app** — pull current jackpot size, odds, and tickets sold from Megapot's Data API so players see real numbers, not static text.
5. **Confirmation UI after a ticket purchase** — show the transaction hash / a link to view it, so judges can see it's real and on-chain, not simulated.

⚠️ **Two things to verify directly with Megapot before you start coding, since I can't fully confirm them myself:**
- The **exact current contract address on Base** — I found one reference (`0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95`) but the page listing it was dated mid-2025, so confirm it's still current on Basescan or in the latest docs.
- Whether an individual **Megapot ticket is minted as its own ERC-721 NFT**, or tracked as an internal ticket count per wallet per round. I could not confirm this either way from the docs I checked — it affects whether you can show "your ticket" as a distinct NFT in a wallet UI, so check `docs.megapot.io` or `llms.megapot.io` directly before designing that screen.

**Fastest path to a correct integration:** fork Megapot's own UI Kit demo repo as your starting point for the wallet/contract-read boilerplate rather than writing it from scratch — it already wires up `purchaseTickets` and constants correctly, and you swap in your own contract address and referral wallet.

---

## 9. Optional Stretch Feature (only if time allows — cut first if behind schedule)

**Community Vault Event:** every few hours, a shared meter appears showing everyone's combined points earned during that window. If the community hits a target together, the game auto-buys a batch of bonus tickets split proportionally among contributors. This is the single feature most directly aligned with Megapot's own stated example of "community ticket pools" and "making the jackpot social" — genuinely worth it for the judging video **if you have time left after the core loop and ticket flow are solid**, but do not start this before the core race + real ticket purchase are both working end-to-end. A half-built stretch feature scores worse than a polished core loop.

---

## 10. Tech Stack Recommendation

| Layer | Recommendation | Why |
|---|---|---|
| Frontend framework | Next.js | Fast to scaffold, works well with wallet libraries |
| Race rendering | Phaser or PixiJS (2D) | A full 3D racer is not realistic in 8 days; 2D top-down/side-view obstacle course is achievable and still reads well in a demo video |
| Wallet connection | Privy (embedded wallets) or RainbowKit + wagmi | Privy lowers onboarding friction for non-crypto-native judges/testers |
| Contract calls | viem or ethers.js | Standard for calling `purchaseTickets` and reading contract state |
| Backend | Node.js/Express, or serverless functions (Vercel) | Handles matchmaking, point calculation, ticket-threshold triggering |
| Real-time sync (if doing live multiplayer) | Socket.io or PartyKit | Only needed if 5 players race live together; consider a seeded-async model (everyone races the same seed, results compared after) if time is tight — much simpler to build and still feels competitive |
| Database | Supabase (Postgres) | Fast to set up, handles player accounts, Point Bank, race history, leaderboard |
| Megapot reference repo | `megapot-ui-kit-demo` (Next.js integration demo) | Fork this for the wallet/purchase flow boilerplate |
| Megapot docs for AI-assisted building | `llms.megapot.io` | Purpose-built for pointing an AI coding assistant at correct, current Megapot integration patterns |

---

## 11. UI/UX Screens Needed

1. **Hub / Home** — wallet connect, Quick Match / Private Lobby buttons, live jackpot ticker, Point Bank summary.
2. **Lobby** — 5 player slots, ready-up, loadout select, room code (for private lobbies).
3. **Race HUD** — timer, live position (1st–5th), points counter, steal flash indicator, jackpot orb glow/alert when it spawns.
4. **Results Screen** — placement, full points breakdown table (finish/collect/clean/steal/podium/jackpot), Point Bank progress bar, Cookie piece indicator (e.g., "2 of 6 pieces"), celebratory state when a ticket is earned (from either path) with the transaction confirmation.
5. **Wallet / Profile** — address, ticket history with tx links (tagged by which path earned them — Point Bank or Cookie), Point Bank progress, Cookie progress, streak status.
6. **Leaderboard** — daily/weekly/all-time, "Most Feared Racer" steal leaderboard.

---

## 12. Suggested Build Order (8 days)

Given the real deadline, sequence matters more than feature count:

1. **Day 1–2:** Single-player race prototype — track generation from a seed, basic barriers, Shards, finish line. Confirm the race is fun with zero other systems attached.
2. **Day 3:** Wallet connect + Megapot contract read (jackpot size, ticket price) displayed in-app. Fork the UI Kit demo here.
3. **Day 4:** Point Bank tracking + `purchaseTickets` call working end-to-end on a small funded treasury — this is the single most important thing to get working before anything else, since it's 30% of the score.
4. **Day 5:** 5-player lobby (start with the seeded-async model if real-time is at risk) + steal mechanic + podium bonuses.
5. **Day 6:** Golden Jackpot Orb feature, results screen with full points breakdown, leaderboard.
6. **Day 7:** Polish, bot-fill for empty lobby slots, bug fixing.
7. **Day 8:** Record demo video, finalize README/integration write-up, submit early — not at 5:59 PM.

If you're behind by Day 5, cut loadouts and the Community Vault stretch feature first. Never cut the working ticket-purchase flow — it's worth more of your score than any single gameplay feature.

---

## 13. Suggested Repo Structure

```
/rally-vault
├── README.md                    # Pitch + Megapot integration write-up (required for judging)
├── /frontend                    # Next.js app: hub, lobby, race, results, wallet, leaderboard
│   ├── /components
│   ├── /game                    # Phaser/PixiJS race scene + track generator
│   └── /lib                     # wallet + contract call wrappers
├── /backend                     # Matchmaking, point calc, ticket-threshold trigger
│   └── /jobs                    # purchaseTickets trigger job
├── /shared
│   ├── megapot-client.ts        # Wraps purchaseTickets, ticket price read, jackpot data read
│   └── constants.ts             # Contract address, ABI, chain config (VERIFY before using)
├── /demo
│   ├── demo-video-link.md
│   └── screenshots/
└── .env.example
```

---

*This document is the build spec for Rally Vault, Megapot Prize Track, Summer Game Jam 2026. Point values, thresholds, and feature scope are starting numbers meant to be tuned during playtesting, not fixed rules — but the Megapot contract details are drawn from official docs and should be re-verified against `docs.megapot.io` immediately before implementation, since blockchain contract details can change.*
