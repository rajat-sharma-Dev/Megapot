# Race rules

Everything on the track, what it is worth, and why. The numbers here are the ones in
`src/lib/points/scoring.ts` and `src/lib/game/engine.ts` — if they disagree, the code is right and
this document is stale.

---

## The one rule everything else serves

**The pot goes to the highest score, not to the first car across the line.**

A full run scores around 140 points. Finishing first is worth 60 of them, and the gap between first
and third is 35 — which four point cells cover. So a driver who won the sprint through an empty lane
loses to a driver who came third and swept the track:

| | 1st place, sloppy | 3rd place, clean sweep |
|---|---|---|
| Point cells | +40 | +90 |
| Finish + position | +85 | +50 |
| Clean run | 0 | +20 |
| Afterburner | +6 | +11 |
| **Total** | **131** | **171 ← takes the pot** |

This is why races stay live to the last corner: until the scores land, nobody knows who won.

---

## Scoring

| Source | Value | Requires finishing? |
|---|---|---|
| Finish | 25 | yes |
| Finish position | 60 / 40 / 25 / 15 / 8 | yes |
| Clean run (no hard hits) | 20 | yes |
| **Jackpot Orb** | **80, +20 per rollover, capped 200** | **yes** |
| Point cell | 10 each | no — banked on pickup |
| Score Trap | −12 each | no |
| Afterburner | 1 per 0.5s on boost, capped 15 | no |
| Near miss | 1, capped 10 | no |
| Steal | ±15, max 2 landed and 2 suffered | no |

A total is never negative.

---

## Quitting

You can leave a race at any time. You keep every point you physically collected. You forfeit
**everything in the "requires finishing" column** — the finish bonus, your finish position, the
clean-run bonus, and the Jackpot Orb.

The in-race HUD reflects this precisely: the big number is labelled **Banked**, and it excludes all
four. If you are carrying the Orb, the HUD shows it separately as `+N orb at the line`, because it is
carried, not banked.

> **The Orb requiring a finish is a bug fix, not flavour.** The end-to-end suite caught the original
> version: take the Orb, quit on the spot, keep 80–200 points that no honest finisher could beat, and
> deny the Orb to everyone else on the way out. That beat playing the race out, which made quitting
> the optimal line in any race with an Orb in it. Requiring the line turns claiming it into a
> commitment — `test-engine.ts` now asserts that quitting with the Orb is strictly worse than
> carrying it home.

---

## Steal Zones

Steal Zones are the one mechanic that moves points *between* players, and the most misread thing in
the game, so here it is exactly.

### Where they are

A track is built from 5–6 sections. A Steal Zone sits on **every boundary between two sections** —
so a 6-section track has 5 of them. They are drawn as violet checkpoint lines across the track, and
they are always at a section change, which means they are visible well before you reach one and are
never a surprise.

```
 START ─┬── section 1 ──┬── section 2 ──┬── section 3 ──┬── section 4 ── FINISH
        │               ▲               ▲               ▲
     no zone         STEAL ZONE      STEAL ZONE      STEAL ZONE
```

### What actually triggers one

Crossing a Steal Zone does **not** steal anything on its own. It fires only on a genuine **overtake**:

> You cross this checkpoint, and there is a rival who was **ahead of you at the previous
> checkpoint** and has **not yet reached this one**.

The engine keeps a crossing order per checkpoint (`checkpointOrder`), and the test is a comparison
between two of them:

```ts
const wasAhead =
  prev === null
    ? other.y > r.y                       // first checkpoint: raw position
    : prev.indexOf(other.id) !== -1 &&    // they crossed the last one…
      (prev.indexOf(r.id) === -1 ||       // …and either you didn't…
       prev.indexOf(other.id) < prev.indexOf(r.id));  // …or they were in front of you
```

At the **first** Steal Zone there is no previous checkpoint to compare against, so it falls back to
raw track position: anyone physically behind you who hasn't crossed yet is a valid target.

### What it is worth

- The stealer **gains 15**. The victim **loses 15**. Points move between players; they are never
  minted, so the total in a race is conserved.
- **One steal per checkpoint, maximum.** The loop breaks after the first valid target.
- **Two steals per race, maximum**, landed. Once you're at two, crossing a zone still records your
  position but takes nothing.
- **Two steals suffered per race, maximum.** This cap is symmetric on purpose: without it, four
  rivals landing two steals each could take 120 points off one racer, and being targeted would be
  ruinous rather than annoying.
- **The finish bonus is protected.** A steal can take everything you earned above it, but never that
  floor. Being robbed twice is exactly the case that would otherwise leave a finisher with nothing.

### Why it is built this way

Three alternatives were rejected, and the reasons are the design:

- **Steal on contact** — turns the race into a bumper-car scrum and rewards driving badly on purpose.
- **Steal by being ahead at the checkpoint** — that is just position, which the finish bonus already
  pays for. It would double-count the same skill and give the leader a snowball.
- **Steal any time you pass someone** — unreadable. Passes happen constantly through traffic and
  nobody could tell which one counted.

Requiring a change in order *between two fixed lines* makes stealing a thing you can see coming,
plan for, and defend against: if you were ahead at the last checkpoint and someone is closing, you
know the next violet line is where it costs you.

### How you defend

You cannot block a steal directly. What you can do is not be caught between checkpoints — which
usually means spending boost on the run into a zone rather than after it. That is the interesting
decision the mechanic exists to create: fuel spent defending a 15-point swing is fuel you don't have
for the cells in the next section.

---

## Boost is a fuel tank, not a pair of charges

Holding `Space` burns fuel and does nothing once the tank is empty. The only way to refill is to
drive through a can. That turns the whole track into a routing problem — spend now to close a gap, or
bank it for the run to the line.

Two details make it the comeback mechanic rather than a straight buff:

- **Boost multiplies through a stun.** At `0.45 × 1.7` you are still below base speed, so a hit
  always costs you — but slamming boost turns a race-ending blade into a recoverable one. This
  replaced two fixed charges precisely because a player who got clipped early had no answer.
- **A crash spills a quarter tank.** Without that, the arithmetic makes reckless boosting optimal: a
  second of boost gains ~91 track units while a hit costs ~36, so one second of fuel outweighs two
  and a half crashes. Charging fuel per impact makes the trade self-limiting.

Fuel cans are deliberately abundant — 13–18 per race, spread one per slice of the track — because
boost is the answer to a bad hit and the answer has to be reachable. Being able to *route* to them is
the skill.

---

## The track

| | |
|---|---|
| **Sections** | 5–6 drawn from 8 templates, no repeats, parameters re-rolled every race |
| **Point cells** | 7–10 per race, 10 points each. **Per-racer** — your score reflects your driving, not which rivals hoovered up the track ahead of you |
| **Fuel cans** | 13–18 per race, +32 fuel each |
| **Score Traps** | Look like point cells, cost 12. Up to 2 per race |
| **Jackpot Orb** | ~40% of races. **Exclusive** — one claimant only. Rolls over and grows when unclaimed |
| **Steal Zones** | Every section boundary |
| **Length** | ~70 seconds |

The Jackpot Orb is the one pickup that is exclusive rather than per-racer, and that is what makes it
the contested moment of a race: everyone can see it, only one person gets it, and they still have to
carry it home.
