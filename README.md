# Rally Vault

**Race for the numbers. Win a real ticket.**

A 5-player obstacle race where the Shards you collect become the numbers on a real
Megapot lottery ticket, minted to your wallet on Base.

Built for the **Megapot Prize Track, Summer Game Jam 2026**.

---

## The idea in one paragraph

A Megapot ticket is five numbers plus a bonusball. In Rally Vault you don't pick them
from a menu — you collect them on a racetrack. Every race generates a fresh track from a
server-issued seed, scatters numbered Shards across it, and sometimes spawns a **Golden
Jackpot Orb** that carries the bonusball. Race well, collect five distinct numbers, grab
the Orb, and the ticket you earn is *literally* assembled from how you played. Bank 600
points and the game buys that ticket for you on-chain and sends it to your wallet.

That's the whole pitch: **the lottery ticket cannot exist without someone having played
the game.** It isn't a reward bolted onto a racer — it's the thing the racer produces.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # defaults target Base Sepolia
npm run dev                     # http://localhost:3000
```

No signup, no wallet extension, no API keys. A wallet is generated for you on first
visit, the same way Megapot's own onboarding creates one for new players.

### Verify the Megapot integration against live contracts

```bash
npm run verify:megapot
```

Reads live drawing state from **both** Base mainnet and Base Sepolia, checks the Data
API, and exercises the Shard→ticket builder against the real ball ranges. Read-only —
it spends nothing.

### Run the tests

```bash
npm run test:engine   # 31 checks — determinism, track generation, economy, tickets
npm run test:e2e      # 61 checks — full HTTP journey against live Base Sepolia
npm test              # both
```

---

## Megapot integration

Everything below was verified against `llms.megapot.io` and the live `Jackpot` ABI.
The app targets **Base Sepolia** by default so no real funds are ever at risk.

### Contracts used

| Contract | Base Sepolia | Base Mainnet |
|---|---|---|
| Jackpot | `0x465dA3c859f193A3807386387bEE941B2A4c3279` | `0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2` |
| JackpotRandomTicketBuyer | `0x53c04e7e5044B28Ea8A4F9c4b26E3Ac1aeb63746` | `0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd` |
| JackpotTicketNFT | `0x45084829ac63f9dC6a3D4981A46FA896f9180ECd` | `0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Switch networks with a single env var: `NEXT_PUBLIC_MEGAPOT_NETWORK=mainnet`.

### How the integration works

**1 · The ticket's numbers are earned in gameplay.**
`Jackpot.buyTickets` takes explicit picks, so the game supplies numbers the player
collected rather than random ones:

```solidity
buyTickets(
  (uint8[] normals, uint8 bonusball)[] _tickets,
  address _recipient,
  address[] _referrers,
  uint256[] _referralSplit,
  bytes32 _source
)
```

`src/lib/megapot/numbers.ts` turns a race into a protocol-valid ticket: the first five
distinct Shards become the normals (sorted ascending), the Golden Orb supplies the
bonusball, and any slot the player didn't earn is filled randomly and **labelled as such
in the UI**. A Score Trap duplicates a number you already hold, so grabbing it burns a
pick slot — the greed punishment is denominated in the currency the game actually runs on.

**2 · The treasury pays; the player receives.**
`_recipient` is the player's wallet, so the ticket NFT is minted directly to them while
the app's treasury covers the USDC. The treasury key is server-only and every purchase
goes through `POST /api/tickets` internals in `src/lib/points/bank.ts` — never the browser.

**3 · Ball ranges are read live, never hardcoded.**
`ballMax` and `bonusballMax` are per-drawing state. They genuinely differ between
networks — Sepolia currently runs **1–25 / 1–13** while mainnet runs **1–30 / 1–10** —
so tracks are generated against a live `getDrawingState()` read and every ticket is
re-validated against a fresh read immediately before purchase. If a range shrinks between
the race and the purchase, out-of-range numbers are re-rolled and the UI says so.

**4 · Two paths, two contracts.**
- **Point Bank** (skill) → `Jackpot.buyTickets` with earned numbers, every 600 points.
- **Cookie** (consistency) → `JackpotRandomTicketBuyer.buyTickets` with protocol-random
  numbers, one piece per 3 races, 6 pieces = 1 guaranteed ticket.

Giving the two paths different on-chain character makes "earned numbers" feel like the
premium outcome without nerfing the guaranteed one.

**5 · Referral revenue is wired up.**
Every purchase passes `_referrers: [treasury]` with a `_referralSplit` of exactly `1e18`.
The protocol pays **10% of ticket price** plus **10% of player winnings**, both read live
from `getDrawingState()`. Claimable via `Jackpot.claimReferralFees()`.

**6 · Settlement is handled.**
When `jackpotLock` is true the protocol is mid-settlement and purchases must not be
attempted. The app detects this, keeps the player's points banked, and reports the ticket
as queued rather than failing the run.

**7 · Live data throughout.**
The Hub's jackpot ticker, prize pool, ticket price, ball ranges and **daily draw
countdown** all come from the chain and `api.megapot.io/v1`. The countdown turns the
protocol's 17:00 UTC cadence into a reason to play now.

### Dry-run mode

`MEGAPOT_DRY_RUN=true` (the default) builds and **simulates** each transaction against
live Base Sepolia state without broadcasting. Malformed tickets, bad referral splits and
wrong addresses still revert exactly as they would on-chain — only failures caused by an
unfunded treasury are waved through, with a clearly-marked `0xdd1f…` synthetic hash.

To mint for real: fund the treasury with Base Sepolia ETH and testnet USDC, then set
`MEGAPOT_DRY_RUN=false`. The code path either side of that flag is identical.

---

## How the game works

| | |
|---|---|
| **Race** | 5 racers, a track generated from a server seed, 60–90 seconds |
| **Sections** | 5–6 drawn from 8 templates, no repeats, parameters re-rolled every time |
| **Shards** | 6–8 per race, each carrying a number. **Per-racer** — everyone builds their own ticket |
| **Golden Orb** | ~40% of races. **Exclusive** — one claimant. Carries the bonusball. Rolls over and stacks when unclaimed |
| **Steal Zones** | Checkpoints only. Overtake a rival who was ahead at the last checkpoint |
| **Boost** | Twice per race |

### Points

| Source | Value |
|---|---|
| Finish | 25 |
| Shard | 8 each |
| Clean run (no hard hits) | 15 |
| Near miss | 1, capped at 8 |
| Steal | ±15, max 2 landed and 2 suffered |
| Podium | 60 / 35 / 20 / 5 / 5 |
| Golden Orb | 80, +20 per rollover, capped 200 |

**600 points = 1 ticket.** Measured across skill levels: **5.1–6.7 races per ticket**.

---

## Architecture

```
src/
├── lib/megapot/      addresses · ABIs · drawing state · ticket construction · purchase · Data API
├── lib/game/         rng · sections · track generation · engine · bots · replay
├── lib/points/       scoring · Point Bank & Cookie settlement
├── lib/db/           file-backed store (swap for Postgres via one module)
├── app/api/          race/create · race/submit · jackpot · player · tickets · leaderboard
├── app/              hub · race · profile · leaderboard
└── components/       canvas renderer · HUD · ticket strip · results
```

### Two decisions worth explaining

**The race engine is headless and deterministic.** Same seed plus same inputs always
produces the same outcome, bit for bit. The browser plays the race and records only its
own input log; the server replays that log and derives the score itself. A client never
reports a score, so a crafted request cannot mint a ticket. The test suite proves this
both ways: 30/30 races replay identically, and a tampered log provably diverges.

**Rendering is Canvas 2D, not a game engine.** The art direction is flat neon geometry,
so a renderer we fully control is smaller than PixiJS, carries no dependency risk, and is
easier to tune. `src/components/race/render.ts` draws the simulation and never mutates it.

---

## Test coverage

`npm run test:engine` — 31 checks:
determinism and tamper-detection · track generation invariants (5–6 sections, no repeats,
≥5 distinct numbers guaranteed, ≤1 Score Trap, ~40% Orb rate) · race duration 60–90s ·
every racer finishes · economy in band across all three skill levels · 300 real races all
producing protocol-valid tickets.

`npm run test:e2e` — 61 checks against a real production server and live Base Sepolia:
live contract reads · input validation · a full race over HTTP · replay protection (409) ·
ownership enforcement (403) · client-supplied scores ignored · oversized logs rejected ·
Point Bank threshold minting a ticket with earned numbers · the Cookie completing at 18
races · profile, tickets and leaderboard aggregation · per-wallet isolation · every page
rendering.

### Bugs these tests caught

Worth listing, because each was silent and would have shipped:

1. **Spike rows were undodgeable.** `halfW = colW/2 − PLAYER_RADIUS` made adjacent columns'
   hit zones tile the track edge-to-edge, leaving no gap. Clean runs were at 0%.
2. **Obstacles could outrun the player.** Amplitude and speed were rolled independently, so
   some obstacles swept sideways at up to 748 units/sec against a player's 300 — unavoidable
   by any skill. Now clamped centrally.
3. **The bot's danger model had blind spots.** It sampled danger at 3 fixed points with a
   ±74-unit window each, so an entire gate could sit between samples unseen. Replaced with
   exact arrival-time prediction per obstacle.
4. **Shards were first-come across all racers.** Five racers split 6–8 Shards, so a typical
   player earned 1 number and got 4 random ones — gutting the core premise. Shards are now
   per-racer; only the Orb is contested.
5. **The Score Trap could destroy a track's guarantee.** It overwrote a random Shard number,
   sometimes one of the five that guaranteed a full ticket was earnable.
6. **Steals could zero a player out.** Four rivals landing two steals each could take 200
   points off one racer. Losses are now capped symmetrically and the finish bonus is protected.

---

## Compliance

This awards real lottery tickets. A production deployment needs an age and jurisdiction
gate before the first race. The jam build runs on **Base Sepolia testnet** with valueless
test USDC, so nothing of value changes hands.

---

## Credits

Built on [Megapot](https://docs.megapot.io) — on-chain lottery on Base.
Integration patterns from [`llms.megapot.io`](https://llms.megapot.io) and the
[Megapot Starter Kit](https://github.com/coordinationlabs/megapot-starter-kit).
