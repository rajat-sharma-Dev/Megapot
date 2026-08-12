# Rally Vault

**Five racers stake a fifth of a Megapot ticket each. The highest score takes the whole pot — and
the pot buys a real lottery ticket, minted straight to the winner's wallet.**

Built for the **Megapot Prize Track, Summer Game Jam 2026**.

---

## The idea in one paragraph

A Megapot ticket costs $1 and rewards nothing but your wallet. In Rally Vault a seat costs **a fifth
of a ticket**, five seats make a race, and the entire pot goes to one driver. Crucially it does not
go to whoever crossed the line first — it goes to whoever **scored** most, and finishing position is
only one of the things that feeds a score. A driver who came third but swept the point cells, kept a
clean run and carried the Jackpot Orb home beats a driver who won the sprint and collected nothing.
Win a full five-seat pot and that is exactly one ticket, minted to you on the spot. Win a smaller one
and the shards stack until they make a whole one.

That's the pitch: **the cheapest way to get a Megapot ticket is to be good at getting one.**

---

## Quick start

```bash
npm install
cp .env.example .env.local      # defaults target Base Sepolia, dry-run, no keys needed
npm run dev                     # http://localhost:3000
```

Connect a real wallet (MetaMask, Rabby, Brave, Coinbase Wallet — anything EIP-1193), deposit some
Base Sepolia USDC, and race.

**To actually take deposits you need a treasury.** Set `TREASURY_PRIVATE_KEY` in `.env.local` to a
throwaway key funded with Base Sepolia ETH and testnet USDC. Without it the app runs, but the deposit
panel says so plainly rather than pretending.

**For a demo with no faucet run**, `RALLY_DEV_FAUCET=true` grants play credits without a real
deposit. It is off by default, refuses to run against mainnet, and labels every granted credit in the
ledger so it can never be mistaken for a deposit.

**Controls:** `←` `→` or `A`/`D` to steer · **hold** `Space` (or `↑`/`W`) to boost · `Esc` or the Quit
button to bail out. On touch, drag anywhere on the track and hold the bottom fifth to boost.

### Verify the Megapot integration against live contracts

```bash
npm run verify:megapot
```

Reads live drawing state from **both** Base mainnet and Base Sepolia, confirms the purchase contract
is deployed and its ABI still matches the signature we call, checks both Data APIs, and derives the
whole economy from each network's live ticket price. Read-only — it spends nothing.

### Run the tests

```bash
npm run test:engine   # 104 checks — determinism, quitting, fuel, the pot, shard conservation
npm run test:e2e      # 118 checks — full HTTP journey against live Base Sepolia
npm test              # both
```

> `test:e2e` builds into `.next-e2e`, so it won't clobber a running `npm run dev`.

---

## How a race works

1. **Deposit.** Connect your wallet and send USDC to the treasury. It's a plain ERC-20 transfer — no
   approvals, no custom contract — and the server credits you by reading that transaction's receipt
   off chain. You can withdraw whenever you like.
2. **Get matched.** Joining charges one entry fee and seats you in the oldest open lobby. Five seats,
   filled at random from whoever is queueing. After 15 seconds the house takes whatever is empty.
3. **Race.** ~70 seconds. Collect point cells, refill your boost tank, dodge traps, claim the orb,
   steal at the checkpoints.
4. **Take the pot.** Highest score takes every shard staked. Five shards is a whole Megapot ticket,
   minted straight to your wallet.

Full rules — every point value, the Steal Zone logic, why the Orb only pays if you finish — are in
**[`docs/GAME-RULES.md`](docs/GAME-RULES.md)**.

The complete Megapot explainer — the drawing lifecycle, how tickets are generated and assigned, where
the money goes, and a checklist for integrating it into any other game — is in
**[`docs/MEGAPOT.md`](docs/MEGAPOT.md)**.

---

## The economy

```
entry fee = live ticketPrice / 5
race pot  = one entry fee per staked seat
5 shards  = 1 real Megapot ticket
```

The entry fee is expressed as a divisor of the live ticket price rather than a fixed dollar amount,
because price is per-drawing protocol state and genuinely differs between networks — **$1.00** on
Base mainnet, **$0.01** on Sepolia. A hardcoded "$0.20" would make the testnet entry fee twenty times
the price of the ticket it is supposed to be buying a fifth of.

So a **full five-seat pot is exactly one ticket**. Win one and it mints immediately. Win a smaller
pot and the shards stay in your vault and count toward the next one — nothing is ever rounded away.
`test-engine.ts` asserts that across 137 simulated wins: minted tickets × price, plus whatever is
still held, always equals exactly what was staked.

### The house is the fifth player

Empty seats are taken by the house, and **the house stakes its own float**. It is a bankroll, not a
subsidy: when a house racer outscores every human the pot goes back to the float, so a solo player is
genuinely playing against something rather than against a mirror. The float can run dry, and when it
does the house seats race for nothing and the pot is only what the humans put in.

`RALLY_HOUSE_STAKE=false` turns it off entirely.

### Real money, both directions

Deposits and withdrawals are always real chain operations. `MEGAPOT_DRY_RUN` governs **ticket
purchases only** — the alternative is accepting a real deposit and simulating the way back out, which
takes people's money.

A deposit is credited by reading the receipt of a transaction the player sent themselves and finding
the USDC `Transfer` to the treasury inside it. The client sends a hash, never an amount. Only logs
emitted by the USDC contract itself count, so a token that merely *claims* to be USDC by emitting an
identical event can't fake a deposit. It's idempotent on the transaction hash, because this is the one
endpoint where a replayed request would mint money.

---

## Architecture

```
src/
├── lib/megapot/      addresses · ABIs · drawing state · purchase · Data API
├── lib/vault/        economy · pot resolution · lobby lifecycle · treasury · serialisation
├── lib/game/         rng · sections · track generation · engine · bots · lobby replay
├── lib/points/       scoring
├── lib/wallet/       wagmi config · connect hook
├── lib/audio/        synthesised sound engine
├── lib/db/           file-backed store (swap for Postgres via one module)
├── app/api/          lobby/join · lobby/[id] · lobby/submit · deposit · withdraw · player · tickets · jackpot
├── app/              landing · play · vault
└── components/       canvas renderer · HUD · matchmaking · results · wallet panels
```

**One authoritative simulation resolves a whole lobby.** The client plays the race and records only
its own inputs; the server replays every seat — a submitted input log for each human, a bot
controller for each house seat — and derives all five scores itself. A client never reports a score,
so a crafted request cannot take a pot. In the overwhelmingly common case (one human against four
house seats) the local race and the authoritative replay are bit-for-bit identical, which the
end-to-end suite asserts as an exact equality rather than an approximation.

**There is no scheduler.** Lobbies lock and settle lazily, driven by whoever next touches them, so
the app is correct on a platform with no cron.

**Rendering is Canvas 2D, not a game engine.** The art direction is flat neon geometry, so a renderer
we fully control is smaller than PixiJS, carries no dependency risk, and is easier to tune. All the
juice — particles, screen shake, boost flame, floating score popups — lives in an `Fx` bag owned by
the view, never in the simulation, because the server replays races with no renderer at all.

**Every sound is synthesised at runtime.** There is not one audio file in the repository. A racing
game needs an engine note that tracks speed and a boost that opens up while held, and a sampled loop
can't do either without a pile of crossfades. Web Audio gives us a continuously variable engine in a
few dozen lines, ships nothing, and has no licensing to get wrong. The landing page hero is a real
race — same engine, same track generator, same renderer — with five bots driving and the camera
following the leader.

---

## Bugs the tests caught

Each of these was silent and would have shipped:

1. **The Jackpot Orb made quitting optimal.** Take the Orb, quit on the spot, keep 80–200 points no
   honest finisher could beat, and deny it to everyone else on the way out. Caught by the end-to-end
   suite asserting that a DNF loses the pot; fixed by making the Orb pay only on a completed run.
2. **Spike rows were undodgeable.** `halfW = colW/2 − PLAYER_RADIUS` made adjacent columns' hit zones
   tile the track edge-to-edge, leaving no gap.
3. **Obstacles could outrun the player.** Amplitude and speed were rolled independently, so some
   obstacles swept sideways at up to 748 units/sec against a player's 300. Now clamped centrally.
4. **The bot's danger model had blind spots.** It sampled danger at 3 fixed points; an entire gate
   could sit between samples unseen. Replaced with exact arrival-time prediction per obstacle.
5. **The bot skill ladder ran backwards.** Danger was summed over a distance that grew with the
   profile's lookahead, so foresight inflated timidity; and `greed` rose faster than `caution`, so
   the "best" bot was the greediest relative to its caution.
6. **Reckless boosting strictly dominated careful driving.** Found by measurement, not inspection —
   fixed by making crashes cost fuel.
7. **Fuel deserts.** Can placement jitter allowed 1,935-unit stretches (~15s) with no fuel.
8. **A schema change crashed every returning player.** A renamed money field meant a bare
   `BigInt(player.credits)` threw on the first race for anyone with an existing profile. The e2e
   suite now boots the server against a fixture written by the old schema.

---

## Known gaps

Stated plainly rather than buried:

- **The datastore blocks a public deploy.** `src/lib/db/store.ts` is a JSON file plus an in-process
  cache. That's ideal for a clean checkout with no credentials, and wrong for Vercel, where an
  ephemeral filesystem and multiple lambdas mean players would lose their standing between requests.
  Swapping in Postgres is a driver change, not a rewrite — every function is already async and the
  shapes are relational. The same applies to the in-process lock that serialises seat assignment.
- **Multi-human lobbies resolve asynchronously.** Everyone races the same track, but you can't see
  the other humans live — your client stands bots in for their seats and labels them ghost lines. The
  authoritative replay uses their real inputs, so with two or more humans the final standings can
  differ slightly from what you watched. Real-time multiplayer needs a socket server, which this
  isn't.
- **The bot difficulty ladder is only half-fixed.** Hard-hit rates follow skill correctly
  (4.9 / 4.7 / 4.5 for rookie / steady / sharp), but finishing *position* does not (2.7 / 3.0 / 3.1).
  The cause is in the engine, not the bots: boost time dominates finishing position, boosting requires
  a clear lane, and a cautious racer that avoids hazards also avoids the pickup lines where the
  boostable stretches are. The test suite asserts the hit-rate ladder and deliberately does **not**
  assert the placement ladder — an always-green assertion encoding a known-wrong claim is worse than
  no assertion.
- **No age or jurisdiction gate.** This awards real lottery tickets. A production deployment needs one
  before the first race. The jam build runs on Base Sepolia with valueless test USDC.
- **`claimReferralFees()` has no code path.** The referral cut accrues on-chain but there is no admin
  route to collect it yet.
- **WalletConnect is not wired up.** It needs a project id and an optional peer dependency; injected
  wallets and Coinbase Wallet cover the rest. See `src/lib/wallet/config.ts`.

---

## Credits

Built on [Megapot](https://docs.megapot.io) — on-chain lottery on Base. Integration patterns from
[`llms.megapot.io`](https://llms.megapot.io) and the
[Megapot Starter Kit](https://github.com/coordinationlabs/megapot-starter-kit).

`docs/ORIGINAL_DESIGN_DOC.md` and `docs/BUILD_SPEC.md` are the original jam brief, kept for
provenance. Where they disagree with the code, the code is right — the daily ladder they describe was
replaced by per-race winner-take-all pots.
