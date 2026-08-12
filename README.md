# Rally Vault

**A fifth of a ticket to enter. Race all day. The leaderboard decides who gets the real ones.**

A 5-player obstacle racer where every entry fee is pooled, and when the day closes the pool
buys real Megapot lottery tickets and mints them straight to the top of the leaderboard.

Built for the **Megapot Prize Track, Summer Game Jam 2026**.

---

## The idea in one paragraph

Buying a Megapot ticket costs $1 and rewards nothing but your wallet. In Rally Vault an entry
costs **a fifth of a ticket**, and what you get for it is a chance to score. Every entry fee
today goes into one shared pool; at 17:00 UTC — the same instant Megapot draws — the pool buys
as many whole tickets as it can afford and mints them directly to players in the order they
finished on that day's ladder. Nobody can buy an advantage, because every entry costs the same
and buys the same thing. Rank is the only lever, and rank is earned by driving.

Then the board wipes and everyone starts level again tomorrow.

That's the pitch: **the cheapest way to get a Megapot ticket is to be good at getting one.**

---

## Quick start

```bash
npm install
cp .env.example .env.local      # defaults target Base Sepolia, dry-run, no keys needed
npm run dev                     # http://localhost:3000
```

No signup, no wallet extension, no API keys. A wallet is generated for you on first visit and
your first 25 entries each day are free, so there is always something to play.

**Controls:** `←` `→` or `A`/`D` to steer · **hold** `Space` (or `↑`/`W`) to boost · `Esc` or the
Quit button to bail out. On touch, drag anywhere on the track and hold the bottom fifth to boost.

### Verify the Megapot integration against live contracts

```bash
npm run verify:megapot
```

Reads live drawing state from **both** Base mainnet and Base Sepolia, confirms the purchase
contract is deployed and its ABI still matches the signature we call, checks both Data APIs, and
derives the entry-fee economy from each network's live ticket price. Read-only — it spends nothing.

### Run the tests

```bash
npm run test:engine   # 92 checks — determinism, quitting, fuel, economy, allocation
npm run test:e2e      # 87 checks — full HTTP journey against live Base Sepolia
npm test              # both
```

> `test:e2e` runs `next build`, which will clobber `.next` underneath a running `npm run dev`
> and 500 every page. Stop the dev server first, or restart it afterwards.

---

## How the game works

| | |
|---|---|
| **Race** | 5 racers, a track generated from a server seed, ~70 seconds |
| **Sections** | 5–6 drawn from 8 templates, no repeats, parameters re-rolled every time |
| **Point cells** | 7–10 per race, 10 points each. **Per-racer** — your score reflects your driving |
| **Fuel cans** | 13–18 per race, +32 fuel. Spread evenly so a comeback is always reachable |
| **Score Traps** | Look like cells, cost 12 points. Up to 2 per race |
| **Jackpot Orb** | ~40% of races. **Exclusive** — one claimant. Rolls over and stacks when unclaimed |
| **Steal Zones** | Checkpoints only. Overtake a rival who was ahead at the last checkpoint |

### Boost is a fuel tank, not a pair of charges

Holding `Space` burns fuel and does nothing once the tank is empty; the only way to refill is to
drive through a can. That turns the whole track into a routing problem — spend now to close a
gap, or bank it for the run to the line.

Two details make it the comeback mechanic rather than a straight buff:

- **Boost multiplies through a stun.** At `0.45 × 1.7` you're still below base speed, so a hit
  always costs you — but slamming boost turns a race-ending blade into a recoverable one. This
  replaced two fixed charges precisely because a player who got clipped early had no answer.
- **A crash spills a quarter tank.** Without that, the arithmetic makes reckless boosting
  optimal: a second of boost gains ~91 track units while a hit costs ~36, so one second of fuel
  outweighs two and a half crashes. Charging fuel per impact makes the trade self-limiting.

### Points

| Source | Value |
|---|---|
| Finish | 25 |
| Point cell | 10 each |
| Score Trap | −12 each |
| Afterburner | 1 per 0.5s on boost, capped at 15 |
| Clean run (no hard hits) | 20 |
| Near miss | 1, capped at 10 |
| Steal | ±15, max 2 landed and 2 suffered |
| Podium | 60 / 35 / 20 / 8 / 5 |
| Jackpot Orb | 80, +20 per rollover, capped 200 |

A mid-skill run lands around **140 points**. Points don't buy anything directly — they are
purely your position on today's ladder.

### Quitting

You can leave a race at any time. You keep every point you physically collected; you forfeit the
**finish bonus, the podium and the clean-run bonus**, all of which show as explicit zeros on the
score sheet. Cutting a bad run short to start a better one is a legitimate play — measured, a
DNF at 45% scores about 29 points against 123 for finishing the same track.

The race still plays out. The client fast-forwards the remaining ticks locally so it reaches the
same outcome the server will derive, rather than guessing at one.

---

## The economy

### Entry fee

```
entry fee = live ticketPrice / 5
```

Expressed as a divisor of the live price rather than a fixed dollar amount, because ticket price
is per-drawing protocol state and genuinely differs between networks — **$1.00** on Base mainnet,
**$0.01** on Sepolia. A hardcoded "$0.20" would make the testnet entry fee twenty times the price
of the ticket it is supposed to be buying a fifth of.

### The vault day

The ladder opens and closes at **17:00 UTC**, pinned to Megapot's own once-a-day draw. A day's
entry fees fund that day's tickets, and the reset lands on the draw itself.

### Payout

At close, the pool converts to whole tickets and they're dealt down the ladder by **harmonic
weight (1/rank)** using largest-remainder apportionment:

- Finishing higher is always worth more — rank 1 gets roughly twice rank 2.
- The tail decays slowly enough that a busy day pays deep into the board, so being 8th at noon
  is still worth playing for.
- Every ticket the pool bought is allocated: never more, never fewer.
- The unspent remainder **carries into tomorrow** rather than evaporating.

Tickets are minted **directly to each player's wallet** at purchase time, so the treasury never
holds anyone's ticket and there are no NFT transfers to trust. A failure for one player is
recorded against that player and their share rolls forward; it never blocks anyone else.

### Free play

Every player is topped up to 25 entries once per vault day. The wallet this game generates on
first visit has no funds and no way to get any, so without a grant there is nothing to test and
nothing to demo. It's a top-up, not a bonus — it sets a floor, so nobody can bank a week of
grants and inflate the pool. `RALLY_FREE_PLAY=false` requires real deposits instead.

---

## Megapot integration

Everything below was verified against `llms.megapot.io` and the live ABIs. The app targets
**Base Sepolia** by default so no real funds are ever at risk.

### Contracts used

| Contract | Base Sepolia | Base Mainnet |
|---|---|---|
| Jackpot (state reads) | `0x465dA3c859f193A3807386387bEE941B2A4c3279` | `0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2` |
| JackpotRandomTicketBuyer (purchases) | `0x53c04e7e5044B28Ea8A4F9c4b26E3Ac1aeb63746` | `0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd` |
| JackpotTicketNFT | `0x45084829ac63f9dC6a3D4981A46FA896f9180ECd` | `0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Switch networks with one env var: `NEXT_PUBLIC_MEGAPOT_NETWORK=mainnet`.

### How the integration works

**1 · The protocol picks the numbers.**

```solidity
JackpotRandomTicketBuyer.buyTickets(
  uint256 _count, address _recipient,
  address[] _referrers, uint256[] _referralSplitBps, bytes32 _source
) returns (uint256[] ticketIds)
```

`_recipient` is the player's wallet, so the ticket NFT is minted directly to them while the
treasury covers the USDC out of the day's pool. Using the protocol's own random buyer means we
never have to reason about ball ranges drifting between a race and a purchase — Megapot picks
valid numbers at mint time, every time.

**2 · The treasury key never reaches the browser.** It lives in a server-only env var, and every
purchase runs inside `src/lib/vault/ladder.ts` (which imports `server-only`). A client that could
ask for a ticket is a client that could mint infinite tickets, so clients can't ask.

**3 · Purchases batch to the contract's limit.** `buyTickets` accepts 1–10, so a player awarded
more than ten gets multiple transactions rather than one silent revert.

**4 · Referral revenue is wired up.** Every purchase passes `_referrers: [treasury]` with a split
of exactly `1e18`. The protocol pays **10% of ticket price** plus **10% of player winnings**, both
read live from `getDrawingState()`.

**5 · Settlement is handled.** When `jackpotLock` is true the protocol is mid-settlement and
purchases must not be attempted. That share of the pool rolls into the next day rather than
failing the payout.

**6 · Live data throughout.** Prize pool, ticket price, ball ranges, `jackpotLock` and the draw
countdown all come from the chain; the profile cross-checks minted tickets against
`api.megapot.io/v1` so you can see they're real and not just rows in our database.

**7 · Payout runs without a scheduler.** There is no cron: the first request after 17:00 UTC
settles the previous day. `POST /api/day/settle` drives it explicitly for tests and demos.

### Dry-run mode

`MEGAPOT_DRY_RUN` defaults to **on**. It builds and **simulates** each transaction against live
chain state without broadcasting — malformed args, bad referral splits and wrong addresses still
revert exactly as they would on-chain; only an unfunded treasury is waved through, with a
clearly-marked `0xdd1f…` synthetic hash. An unset variable must never mean "spend real money", so
the only way to broadcast is `MEGAPOT_DRY_RUN=false` explicitly.

---

## Architecture

```
src/
├── lib/megapot/      addresses · ABIs · drawing state · purchase · Data API
├── lib/vault/        day boundaries · entry fees · ticket allocation · ladder settlement
├── lib/game/         rng · sections · track generation · engine · bots · replay
├── lib/points/       scoring
├── lib/db/           file-backed store (swap for Postgres via one module)
├── app/api/          race/create · race/submit · day/settle · jackpot · player · tickets · leaderboard
├── app/              hub · race · profile · leaderboard
└── components/       canvas renderer · HUD · fuel gauge · score sheet
```

**The race engine is headless and deterministic.** Same seed plus same inputs always produces the
same outcome, bit for bit. The browser plays the race and records only its own input log; the
server replays that log and derives the score itself. A client never reports a score, so a
crafted request cannot climb the ladder. The suite proves it both ways: 30/30 races replay
identically, and a tampered log provably diverges.

**Rendering is Canvas 2D, not a game engine.** The art direction is flat neon geometry, so a
renderer we fully control is smaller than PixiJS, carries no dependency risk, and is easier to
tune. All the juice — particles, screen shake, boost flame, floating score popups — lives in an
`Fx` bag owned by the view, never in the simulation, because the server replays races with no
renderer at all.

---

## Test coverage

`npm run test:engine` — **92 checks**: determinism and tamper detection · run-length boost
encoding round-trips · quitting (DNF zeroes, replay fidelity, instant-quit edge case) · fuel
economics and no-fuel-desert guarantees · track invariants · race duration and feel · bot
profiles · the point economy · vault-day boundary arithmetic at 17:00 UTC · entry-fee derivation
on both networks · pool→ticket conversion and carry-over · ticket allocation (conservation,
rank monotonicity, determinism, tie-breaking).

`npm run test:e2e` — **87 checks** against a real production server and live Base Sepolia:
live contract reads · input validation · entry-fee debit and pool credit · a full race over HTTP ·
quitting over HTTP · replay protection (409) · ownership enforcement (403) · client-supplied
scores ignored · **hostile boost-run encodings clamped** · the daily ladder (sorting, dense ranks,
projection summing to the pool) · **day close buying real tickets and minting them to ranked
winners** · settlement idempotency · carry-over accounting · per-wallet isolation · running out of
entries (402) · every page rendering.

### Bugs these tests caught

Each of these was silent and would have shipped:

1. **Spike rows were undodgeable.** `halfW = colW/2 − PLAYER_RADIUS` made adjacent columns' hit
   zones tile the track edge-to-edge, leaving no gap.
2. **Obstacles could outrun the player.** Amplitude and speed were rolled independently, so some
   obstacles swept sideways at up to 748 units/sec against a player's 300. Now clamped centrally.
3. **The bot's danger model had blind spots.** It sampled danger at 3 fixed points; an entire gate
   could sit between samples unseen. Replaced with exact arrival-time prediction per obstacle.
4. **The bot skill ladder ran backwards.** Two independent causes: danger was summed over a
   distance that grew with the profile's lookahead (so foresight inflated timidity and saturated
   the signal), and `greed` rose faster than `caution` (so the "best" bot was the greediest
   relative to its caution). Both fixed; see the note in *Known gaps*.
5. **Reckless boosting strictly dominated careful driving.** Found by measurement, not inspection —
   fixed by making crashes cost fuel.
6. **Fuel deserts.** Can placement jitter allowed 1,935-unit stretches (~15s) with no fuel, long
   enough that a player who spent their tank had no route back into the race.
7. **`.env.example` didn't exist.** A blanket `.env*` gitignore rule swallowed it, so the README's
   own quick-start instruction failed on a clean checkout.

---

## Known gaps

Stated plainly rather than buried:

- **The bot difficulty ladder is only half-fixed.** Hard-hit rates now follow skill correctly
  (4.9 / 4.7 / 4.5 for rookie / steady / sharp over 80 races each), but finishing *position* does
  not (2.5 / 3.2 / 3.3). The cause is in the engine, not the bots: boost time dominates finishing
  position, boosting requires a clear lane, and a cautious racer that avoids hazards also avoids
  the pickup lines where the boostable stretches are. Making a crash cost fuel narrowed this;
  raising that penalty further barely moved it, because the binding constraint is fuel
  *abundance*, not the price of a crash. The real fix is retuning can density against crash cost
  together, which needs playtesting rather than another parameter sweep. The test suite asserts
  the hit-rate ladder and deliberately does **not** assert the placement ladder — an always-green
  assertion encoding a known-wrong claim is worse than no assertion.
- **The datastore blocks a public deploy.** `src/lib/db/store.ts` is a JSON file plus an
  in-process cache. That's ideal for a clean checkout with no credentials, and wrong for Vercel,
  where an ephemeral filesystem and multiple lambdas mean players would lose their standing
  between requests. Swapping in Postgres is a driver change, not a rewrite — every function is
  already async and the shapes are relational.
- **No age or jurisdiction gate.** This awards real lottery tickets. A production deployment needs
  one before the first race. The jam build runs on Base Sepolia with valueless test USDC, so
  nothing of value changes hands.
- **`claimReferralFees()` has no code path.** The referral cut accrues on-chain but there is no
  admin route to collect it yet.
- **Real USDC deposits aren't wired.** Credits are granted, not purchased. The ledger and the
  charging path are real; only the top-up route is missing.

---

## Credits

Built on [Megapot](https://docs.megapot.io) — on-chain lottery on Base.
Integration patterns from [`llms.megapot.io`](https://llms.megapot.io) and the
[Megapot Starter Kit](https://github.com/coordinationlabs/megapot-starter-kit).
