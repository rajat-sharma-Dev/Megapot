/**
 * The vault ladder — where gameplay turns into on-chain tickets.
 *
 * The whole economy in one paragraph: entering a race costs a fifth of a Megapot
 * ticket. Those fees pool for the day. When the day closes at 17:00 UTC — the
 * same instant Megapot draws — the pool buys as many whole tickets as it can
 * afford and mints them straight to players in the order they finished on that
 * day's ladder. Whatever the pool couldn't spend rolls into tomorrow.
 *
 * Two consequences worth stating, because they are the point of the design:
 *
 *  · You cannot buy your way to a better outcome. Every entry costs the same and
 *    buys the same thing — a chance to score. Rank is the only lever, and rank is
 *    earned by driving. Someone who wants tickets without playing should just buy
 *    a ticket from Megapot directly; this game exists for the people who'd rather
 *    win one.
 *  · The board resets daily, so a bad run is never permanent. Being 40th at noon
 *    costs you nothing tomorrow, and nothing at 16:00 either if you can climb.
 *
 * Everything here is server-side. A race is settled exactly once, and points are
 * always derived from a server-side replay — never from anything a client claims.
 */

import 'server-only';
import {
  getRace, settleRace, getOrCreatePlayer, updatePlayer, recordTicket, adjustCredits,
  getOrbRollover, bumpOrbRollover, getOrCreateDay, getDay, addEntryFee, markDaySettled, toUnits,
  addLadderPoints, getLadder, listUnsettledDays,
  type Player, type TicketRecord, type DayAllocation, type VaultDay,
} from '../db/store';
import { scoreRace, type ScoreBreakdown } from '../points/scoring';
import { buyTicketsFor, SettlementInProgressError } from '../megapot/purchase';
import { getCurrentDrawing } from '../megapot/drawing';
import { NETWORK } from '../megapot/addresses';
import { allocateTickets, poolToTickets } from './allocate';
import { vaultDayKey, isClosed } from './day';
import { ENTRIES_PER_TICKET, entryFeeUnits, FREE_ENTRIES_PER_DAY } from './economy';
import type { RaceOutcome } from '../game/types';

// Re-exported so server routes can pull the whole vault surface from one module.
export { ENTRIES_PER_TICKET, entryFeeUnits, FREE_ENTRIES_PER_DAY };

/** Set RALLY_FREE_PLAY=false to require real deposits instead of the daily grant. */
const FREE_PLAY = process.env.RALLY_FREE_PLAY !== 'false';

export type EntryResult = {
  player: Player;
  dayKey: string;
  entryFeeUnits: bigint;
  creditsAfter: bigint;
  poolUnits: bigint;
};

/**
 * Top a player up to the daily free-entry allowance.
 *
 * Deliberately a top-up rather than a bonus: it sets a floor instead of
 * accumulating, so nobody can bank a week of grants and it can never inflate the
 * pool beyond what a day of play would raise.
 */
export async function ensureDailyGrant(
  player: Player,
  dayKey: string,
  feeUnits: bigint,
): Promise<Player> {
  if (!FREE_PLAY) return player;
  if (player.lastGrantDay === dayKey) return player;

  const floor = feeUnits * FREE_ENTRIES_PER_DAY;
  const have = toUnits(player.credits);
  const patch: Partial<Player> = { lastGrantDay: dayKey };
  if (have < floor) patch.credits = floor.toString();

  return updatePlayer(player.id, patch);
}

/** Charge the entry fee and open a race. Throws if the player can't pay. */
export async function chargeEntry(
  address: string,
  name: string | undefined,
  ticketPriceUnits: bigint,
): Promise<EntryResult> {
  const dayKey = vaultDayKey();
  const feeUnits = entryFeeUnits(ticketPriceUnits);

  let player = await getOrCreatePlayer(address, name);
  player = await ensureDailyGrant(player, dayKey, feeUnits);

  if (toUnits(player.credits) < feeUnits) {
    throw new Error(
      `Not enough credits to enter: need ${feeUnits} base units, have ${player.credits}. ` +
        `Today's allowance resets when the vault day rolls over at 17:00 UTC.`,
    );
  }

  const creditsAfter = await adjustCredits(player.id, -feeUnits);
  await getOrCreateDay(dayKey);
  const day = await addEntryFee(dayKey, feeUnits);

  return {
    player: { ...player, credits: creditsAfter.toString() },
    dayKey,
    entryFeeUnits: feeUnits,
    creditsAfter,
    poolUnits: toUnits(day.poolUnits),
  };
}

export type SettlementResult = {
  breakdown: ScoreBreakdown;
  placement: number;
  pointsAwarded: number;
  retired: boolean;
  dayKey: string;
  /** The player's totals on today's ladder after this race. */
  dayPoints: number;
  dayRaces: number;
  dayRank: number;
  dayBest: number;
  lifetimePoints: number;
  racesCompleted: number;
  bestRaceScore: number;
  isPersonalBest: boolean;
  credits: string;
  orbRollover: number;
};

/**
 * Settle one submitted race.
 *
 * No ticket is bought here — tickets are a once-a-day event driven by the ladder,
 * not a per-race payout. That is what makes the daily board the thing players
 * actually compete over.
 */
export async function settleRaceForPlayer(
  raceId: string,
  playerId: string,
  outcome: RaceOutcome,
): Promise<SettlementResult> {
  const race = await getRace(raceId);
  if (!race) throw new Error(`Unknown race ${raceId}`);
  if (race.playerId !== playerId.toLowerCase()) {
    throw new Error('Race does not belong to this player');
  }
  if (race.settledAt) throw new Error('Race already settled');
  if (outcome.seed !== race.seed) {
    throw new Error('Outcome seed does not match the issued race seed');
  }

  const rollover = await getOrbRollover();
  const breakdowns = scoreRace(outcome, rollover);
  const mine = breakdowns.find(
    (b) => b.racerId === playerId.toLowerCase() || b.racerId === playerId,
  );
  if (!mine) throw new Error('Player not present in race outcome');

  // Orb rollover: stacks whenever nobody claimed it this race.
  const orbClaimed = outcome.racers.some((r) => r.hasOrb);
  const newRollover = await bumpOrbRollover(orbClaimed);

  const player = await getOrCreatePlayer(playerId);
  const isPersonalBest = mine.total > player.bestRaceScore;
  const me = outcome.racers.find((r) => r.id === mine.racerId);

  const updated = await updatePlayer(player.id, {
    lifetimePoints: player.lifetimePoints + mine.total,
    racesCompleted: player.racesCompleted + 1,
    racesRetired: player.racesRetired + (mine.retired ? 1 : 0),
    bestRaceScore: Math.max(player.bestRaceScore, mine.total),
    totalStolen: player.totalStolen + (me?.steals ?? 0),
  });

  // The race counts toward the day it was ISSUED on, not the day it was
  // submitted. Otherwise a race started at 16:59 and finished at 17:01 would
  // score against a day whose pool never received its entry fee.
  const entry = await addLadderPoints(
    race.dayKey,
    { id: player.id, name: player.name },
    mine.total,
    mine.retired,
  );

  const ladder = await getLadder(race.dayKey);
  const dayRank = ladder.findIndex((e) => e.playerId === player.id) + 1;

  await settleRace(race.id, {
    placement: mine.placement,
    pointsAwarded: mine.total,
    retired: mine.retired,
  });

  return {
    breakdown: mine,
    placement: mine.placement,
    pointsAwarded: mine.total,
    retired: mine.retired,
    dayKey: race.dayKey,
    dayPoints: entry.points,
    dayRaces: entry.races,
    dayRank,
    dayBest: entry.bestScore,
    lifetimePoints: updated.lifetimePoints,
    racesCompleted: updated.racesCompleted,
    bestRaceScore: updated.bestRaceScore,
    isPersonalBest,
    credits: updated.credits,
    orbRollover: newRollover,
  };
}

export type DaySettlementResult = {
  day: VaultDay;
  ticketsBought: number;
  allocations: DayAllocation[];
  tickets: TicketRecord[];
};

/**
 * Close a day: convert its pool into tickets and mint them down the ladder.
 *
 * Tickets are minted directly to each player's wallet at purchase time, so the
 * treasury never holds anyone's ticket and there are no NFT transfers to trust.
 * A failure for one player is recorded against that player and their share of the
 * pool rolls forward — it never blocks anyone else's tickets.
 */
export async function settleDay(dayKey: string): Promise<DaySettlementResult> {
  const day = await getDay(dayKey);
  if (!day) throw new Error(`Unknown vault day ${dayKey}`);
  if (day.settlement) {
    return {
      day,
      ticketsBought: day.settlement.ticketsBought,
      allocations: day.settlement.allocations,
      tickets: [],
    };
  }

  const drawing = await getCurrentDrawing();
  const pool = toUnits(day.poolUnits);
  const { tickets: ticketCount, carryOutUnits } = poolToTickets(pool, drawing.ticketPrice);

  const ladder = await getLadder(dayKey);
  const allocations = allocateTickets(
    ladder.map((e) => ({ playerId: e.playerId, name: e.name, points: e.points })),
    ticketCount,
  );

  const records: TicketRecord[] = [];
  const settledAllocations: DayAllocation[] = [];
  let unspent = 0n;

  for (const a of allocations) {
    if (a.tickets <= 0) {
      settledAllocations.push({ ...a, txHash: null, error: null });
      continue;
    }

    try {
      const results = await buyTicketsFor(a.playerId as `0x${string}`, a.tickets);

      for (const [i, res] of results.entries()) {
        records.push(
          await recordTicket({
            id: `${res.txHash}-${i}`,
            playerId: a.playerId,
            txHash: res.txHash,
            drawingId: res.drawingId.toString(),
            count: res.count,
            dayKey,
            rank: a.rank,
            points: a.points,
            network: NETWORK,
          }),
        );
      }

      const player = await getOrCreatePlayer(a.playerId);
      await updatePlayer(player.id, { ticketsEarned: player.ticketsEarned + a.tickets });

      settledAllocations.push({ ...a, txHash: results[0]?.txHash ?? null, error: null });
    } catch (err) {
      // This player's share stays in the pool and rolls into tomorrow.
      unspent += drawing.ticketPrice * BigInt(a.tickets);
      settledAllocations.push({
        ...a,
        txHash: null,
        error:
          err instanceof SettlementInProgressError
            ? 'Megapot was mid-settlement; this share rolled into the next day.'
            : (err as Error).message,
      });
    }
  }

  const updatedDay = await markDaySettled(dayKey, {
    settledAt: new Date().toISOString(),
    ticketPriceUnits: drawing.ticketPrice.toString(),
    drawingId: drawing.drawingId.toString(),
    totalPoolUnits: pool.toString(),
    ticketsBought: records.reduce((s, r) => s + r.count, 0),
    carryOutUnits: (carryOutUnits + unspent).toString(),
    allocations: settledAllocations,
  });

  return {
    day: updatedDay,
    ticketsBought: records.reduce((s, r) => s + r.count, 0),
    allocations: settledAllocations,
    tickets: records,
  };
}

/**
 * Settle every day that has closed and not yet paid out.
 *
 * Called opportunistically from the API rather than from a cron, so the app is
 * correct on a platform with no scheduler: whoever shows up first after 17:00
 * UTC triggers yesterday's payout. Failures are swallowed — an unsettled day
 * stays unsettled and gets retried on the next request rather than breaking
 * whatever the caller was actually doing.
 */
export async function settleDueDays(): Promise<DaySettlementResult[]> {
  const today = vaultDayKey();
  const due = await listUnsettledDays(today);
  const done: DaySettlementResult[] = [];

  for (const day of due) {
    if (!isClosed(day.key)) continue;
    try {
      done.push(await settleDay(day.key));
    } catch {
      // Leave it for the next request.
    }
  }
  return done;
}
