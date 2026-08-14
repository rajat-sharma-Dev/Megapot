# Megapot, end to end

Everything in this document was verified against the live ABIs at
[`llms.megapot.io`](https://llms.megapot.io), the Data API at `api.megapot.io/v1`, and live
contract reads on both Base mainnet and Base Sepolia. Run `npm run verify:megapot` to re-check
all of it yourself — it reads the chain and spends nothing.

The point of this document is that you should be able to integrate Megapot into *any* game after
reading it, not just this one.

---

## 1 · What Megapot actually is

Megapot is an on-chain lottery on **Base**. It is not a raffle over the entrants and it is not a
prize pool split among participants. It is a **number-matching lottery** with a jackpot backed by
liquidity providers:

- Players buy tickets in **USDC**.
- Each ticket carries a set of **normal numbers** plus one **bonusball**.
- At the end of each drawing the protocol reveals a winning combination.
- Payouts are made by **prize tier** — how many normals you matched, and whether you matched the
  bonusball.
- The jackpot is underwritten by **liquidity providers**, which is why a $1 ticket can be worth a
  million-dollar prize on day one. LPs take the other side of the bet and earn `lpEarnings`.

The three facts that matter most for an integration:

| Fact | Consequence for your game |
|---|---|
| Ticket price is **per-drawing protocol state**, not a constant | Never hardcode `$1`. Read it. |
| The **ball ranges change between drawings** | Never hardcode `1–30`. Read them, or let the protocol pick. |
| A ticket is an **NFT minted to a recipient you name** | You can mint straight to a player's wallet. You never have to custody it. |

---

## 2 · The drawing lifecycle

A **drawing** (the Data API calls it a *round*) is one complete cycle:

```
open ──────────────────────────► cutoff ──────► settling ──────► settled
  tickets can be bought        drawingTime    jackpotLock=true   winningTicket set
                                                                 prizes claimable
```

Read the whole state in one call:

```solidity
Jackpot.currentDrawingId() returns (uint256)

Jackpot.getDrawingState(uint256 drawingId) returns (
  uint256 prizePool,           // current jackpot, in USDC base units (6dp)
  uint256 ticketPrice,         // THE number your economy must be derived from
  uint256 edgePerTicket,       // protocol fee taken per ticket
  uint256 referralWinShare,    // 1e18-scaled — share of a referred player's WINNINGS
  uint256 referralFee,         // 1e18-scaled — share of TICKET PRICE paid to referrers
  uint256 globalTicketsBought,
  uint256 lpEarnings,
  uint256 drawingTime,         // unix seconds — when this drawing closes
  uint256 winningTicket,
  uint8   ballMax,             // normals are 1..ballMax        ← per drawing
  uint8   bonusballMax,        // bonusball is 1..bonusballMax   ← per drawing
  address payoutCalculator,
  bool    jackpotLock          // true while the protocol is mid-settlement
)
```

**Cadence.** On Base mainnet a drawing closes daily at **17:00 UTC**. On Base Sepolia the cadence
is faster and irregular — at the time of writing a testnet round was closing at 19:50 UTC the same
day. Treat `drawingTime` as the only truth; do not build a schedule around 17:00.

**`jackpotLock` is a hard gate.** While it is true the protocol is settling and a purchase will
fail. Rally Vault treats a lock as "queue this, don't attempt it" and tells the player their shards
are safe — see `SettlementInProgressError` in `src/lib/megapot/purchase.ts`.

---

## 3 · What a ticket is

A ticket is an **ERC-721** (`JackpotTicketNFT`) held by whoever it was minted to. Its content is a
number combination:

```
normals:   [n₁, n₂, … ]   each in 1..ballMax
bonusball: b               in 1..bonusballMax
```

Both ranges come from the drawing you are buying into. As of this writing mainnet round 142 ran
`normals 1–30, bonusball 1–10` while testnet round 7703 ran `normals 1–25, bonusball 1–13`. They
are genuinely different, they genuinely move, and a hardcoded range produces tickets that revert.

Because the ticket is an NFT and not a database row, a ticket minted to a player is theirs
unconditionally. Your server can disappear and they still hold it.

---

## 4 · How tickets are generated

There are three ways to get a ticket on chain, and the difference between them is *who chooses the
numbers*.

### a) `JackpotRandomTicketBuyer` — the protocol picks (what Rally Vault uses)

```solidity
JackpotRandomTicketBuyer.buyTickets(
  uint256   _count,             // 1..10 per call
  address   _recipient,         // ← the NFT is minted HERE
  address[] _referrers,
  uint256[] _referralSplitBps,  // 1e18-scaled weights, must sum to EXACTLY 1e18
  bytes32   _source             // attribution tag
) returns (uint256[] ticketIds)
```

This is the right default for a game, for one specific reason: **the numbers are chosen at mint
time by the protocol**, so you never have to reason about ball ranges drifting between the moment a
player earns a ticket and the moment you buy it. A player might win a pot at 16:58 and the purchase
lands at 17:01 in a new drawing with a different `ballMax`; with the random buyer that is a
non-event.

Two constraints to design around:

- **`_count` is 1–10.** More than ten tickets means more than one transaction. `buyTicketsFor()`
  batches for you.
- **`_referralSplitBps` must sum to exactly `1e18`.** Not 10000, not 100. A single referrer takes
  `[1_000_000_000_000_000_000n]`. Get this wrong and it reverts — which the dry-run catches, because
  simulation reverts identically.

### b) `Jackpot` directly — you pick the numbers

Use this only if number choice is part of your product (a "pick your own" feature). You must read
`ballMax` / `bonusballMax` from the drawing you are buying into and validate against them yourself,
on every purchase.

### c) `BatchPurchaseFacilitator` — many recipients, one transaction

Worth reaching for if you ever pay out to many wallets at once. Rally Vault does not need it: pots
have exactly one winner, so purchases are always for a single recipient.

---

## 5 · How tickets are assigned to a player

This is the part most integrations overcomplicate. **You do not need to custody anything.**

`_recipient` is an arbitrary address. Set it to the player's wallet and the NFT is minted directly
to them, in the same transaction that spends your USDC:

```
treasury USDC ──► JackpotRandomTicketBuyer ──► ticket NFT ──► PLAYER'S WALLET
```

There is no second transfer, no escrow, no claim step, and no window in which the treasury holds
somebody else's ticket. If your app is compromised the day after a purchase, the ticket is still
theirs.

The treasury needs USDC and a little ETH for gas; that is the whole custody story. Concretely:

```ts
// src/lib/megapot/purchase.ts
await ensureAllowance(CONTRACTS.randomTicketBuyer, ticketPrice * BigInt(count));
const txHash = await wallet.writeContract({
  address: CONTRACTS.randomTicketBuyer,
  abi: RANDOM_TICKET_BUYER_ABI,
  functionName: 'buyTickets',
  args: [BigInt(count), playerAddress, [treasury], [PRECISE_UNIT], SOURCE_TAG],
});
```

The random buyer pulls the USDC itself, so **it** is the spender to approve — not the Jackpot
contract. That is a real trap: approving the wrong address produces a transfer failure that reads
like an unfunded treasury.

---

## 5b · Claiming — the half that gets forgotten

Buying a ticket is not the end of the lifecycle. When a drawing settles, a
winning ticket has to be **redeemed**:

```solidity
Jackpot.claimWinnings(uint256[] ticketIds)   // burns the tickets, transfers USDC
```

**The player signs this, not your backend, and that is the correct shape rather
than a limitation.** The ticket is an ERC-721 in their wallet; a server that
could claim on their behalf would be a server that could redirect their
winnings. Rally Vault has no code that could do it — `src/app/api/wins/route.ts`
only *reads*, and the transaction is signed in
`src/components/wallet/ClaimWinnings.tsx` by the player's own wallet.

Finding what is claimable is a Data API job, not an RPC one. `GET
/v1/wallets/{address}/wins` returns `Win` objects carrying exactly what you
need:

| Field | Use |
|---|---|
| `user_ticket_id` | the value `claimWinnings` takes |
| `claimed` | so you never offer a claim for money already taken |
| `claimed_tx_hash` | link the receipt |
| `amount` | `{ amount, decimals }` — parse as an integer, never a float |
| `matched_normals`, `bonusball_match` | which prize tier it landed in |

### Knowing whether a drawing has been drawn

`jackpotLock` answers a *different question* and it is an easy mix-up:

```ts
const drawn = state.winningTicket !== 0n;   // settled, numbers fixed
const settling = state.jackpotLock;         // mid-settlement RIGHT NOW
```

`jackpotLock` is true only during the settlement window itself, so a drawing that
finished an hour ago has `jackpotLock === false` exactly like one that hasn't
started. Use `winningTicket` for "is it settled". The most recently settled
drawing is always `currentDrawingId() - 1`, because the active one is by
definition unsettled. Both are implemented in `src/lib/megapot/drawing.ts` as
`isDrawn()` and `lastSettledDrawingId()`.

## 6 · How winning works

At settlement the protocol fixes a winning combination and the payout calculator resolves prizes by
tier. From the Data API's `prize_tiers`:

```jsonc
{
  "tier_id": 3,
  "normal_matches": 4,        // how many normals this tier requires
  "bonusball_match": true,    // and whether the bonusball must match
  "payout":  { "amount": "…", "decimals": 6 },
  "ticket_count": 12          // how many tickets landed in this tier
}
```

So there are consolation tiers, not only a jackpot. A player holding one of your tickets can win
something without winning everything.

**Your game does not resolve any of this.** You buy tickets; Megapot decides who won and pays them.
Rally Vault never claims a prize on a player's behalf and has no code that could — the ticket is in
their wallet and the payout is between them and the protocol.

---

## 7 · Where the money goes

Per ticket sold:

- **`edgePerTicket`** — the protocol's cut.
- **`referralFee`** — paid to the addresses in `_referrers`, split by `_referralSplitBps`.
  Currently **10% of ticket price**, read live rather than assumed.
- **`referralWinShare`** — additionally, **10% of a referred player's winnings**.
- The remainder funds the prize pool, with LPs underwriting the difference.

Referral revenue is how an integration like this can be free for the player and still make money.
Rally Vault passes its own treasury as the referrer on every purchase, so it earns the referral cut
on tickets its players win.

**Collecting it needs a code path, and that is easy to leave out.** Fees accrue on the Jackpot
contract from the first sale and sit there until somebody calls `claimReferralFees()`. Wiring the
referrer without ever wiring the sweep makes the whole thing decorative. Here:

```
GET  /api/admin/referral   what has accrued, plus the live fee rates. Read-only.
POST /api/admin/referral   sweeps it, gated on RALLY_ADMIN_SECRET.
```

One trap worth naming: **`claimReferralFees()` pays `msg.sender`**. If you name a referrer address
that is different from the wallet holding your signing key, that other wallet has to claim its own
fees — a sweep signed by the treasury would credit the treasury, not the referrer. The route detects
the mismatch and refuses rather than sending a transaction that pays the wrong address.

---

## 8 · The contracts

| Contract | Base Mainnet | Base Sepolia |
|---|---|---|
| Jackpot (state reads) | `0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2` | `0x465dA3c859f193A3807386387bEE941B2A4c3279` |
| JackpotRandomTicketBuyer | `0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd` | `0x53c04e7e5044B28Ea8A4F9c4b26E3Ac1aeb63746` |
| JackpotTicketNFT | `0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4` | `0x45084829ac63f9dC6a3D4981A46FA896f9180ECd` |
| BatchPurchaseFacilitator | `0xBA343479D98a1Ed333899999D95a7343B808a76F` | `0x62A5D60F486D01a28071652a7951Aff1EA4c5b7c` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

> The address `0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95`, which circulates in older write-ups, is
> **stale**. Do not use it.

Switch networks with one variable: `NEXT_PUBLIC_MEGAPOT_NETWORK=mainnet`.

**Data API** — `https://api.megapot.io/v1` (mainnet) and `https://api-testnet.megapot.io/v1`
(testnet, a different host). 120 req/min anonymous, 300 with a key. Useful endpoints:
`/rounds/active`, `/rounds/latest-settled`, `/wallets/{address}/tickets`, `/wallets/{address}/wins`,
`/wallets/{address}/stats`. Every monetary value arrives as `{ amount: "<integer string>",
decimals: n }` — parse those as integers, never as floats.

---

## 9 · Integrating Megapot into a different game

The checklist, in order of how badly each one bites:

1. **Derive your prices from `ticketPrice`, never from a constant.** Rally Vault's entry fee is
   literally `ticketPrice / 5`. On mainnet that's $0.20; on Sepolia it's $0.002. A hardcoded "$0.20"
   would make the testnet entry fee twenty times the price of the ticket it is supposed to be buying
   a fifth of — the bug would be invisible until someone tried the testnet build.

2. **Keep the buying key server-side.** A client that can ask for a ticket is a client that can mint
   infinite tickets. In this repo every purchase path imports `server-only`, which turns an
   accidental client import into a build error rather than a breach.

3. **Mint to the player, never to yourself.** Pass their address as `_recipient`. Custody is a
   liability with no upside.

4. **Handle `jackpotLock`.** Check it before buying and queue rather than fail.

5. **Debit the player *after* the purchase succeeds, not before.** Rally Vault's `mintFromVault()`
   only deducts a player's shards once `buyTickets` has confirmed. A failed mint therefore leaves the
   value exactly where it was, and the next win retries. Losing someone's ticket to a transient RPC
   error is not an acceptable failure mode.

6. **Make dry-run the default.** `MEGAPOT_DRY_RUN` defaults to **on** here and *simulates* every
   purchase against live chain state — malformed args, bad referral splits and wrong addresses still
   revert exactly as they would on-chain; only an unfunded treasury is waved through, with a clearly
   marked `0xdd1f…` synthetic hash. An unset variable must never mean "spend real money".

7. **Batch above ten.** `buyTickets` takes 1–10.

8. **Cross-check against the Data API.** Showing Megapot's own view of a wallet next to your own
   records is what turns "we minted you a ticket" from a claim into something the player can verify.

---

## 10 · What Rally Vault does with all this

```
5 players × (ticketPrice ÷ 5)  ──►  one race pot
                                      │
              highest SCORE takes it  ▼
                              winner's shard vault
                                      │
                    vault ≥ ticketPrice▼
                    JackpotRandomTicketBuyer.buyTickets(…, recipient = winner)
                                      │
                                      ▼
                       ticket NFT in the winner's wallet
```

Every entry fee is a fifth of a ticket, so **a full five-seat pot is exactly one ticket**. Win one
and it mints on the spot. Win a smaller pot and the shards stack in your vault until they make a
whole one — nothing is ever rounded away, which `npm run test:engine` asserts across 137 simulated
wins and `npm run verify:megapot` re-checks against both networks' live prices.
