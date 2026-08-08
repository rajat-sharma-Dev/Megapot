/**
 * Point Bank settlement — where gameplay turns into on-chain tickets.
 *
 * Two independent paths, exactly as specified:
 *   · Point Bank — skill. Every TICKET_THRESHOLD points buys a ticket carrying
 *     the numbers the player EARNED on the track.
 *   · Cookie — consistency. Every 3 races earns a piece; 6 pieces buys a ticket
 *     with protocol-random numbers.
 *
 * Everything here is server-side and idempotent per race: a race that has
 * already been settled cannot be settled again, so a replayed request can never
 * mint a second ticket.
 */

import 'server-only';
import {
  getRace, settleRace, getOrCreatePlayer, updatePlayer, recordTicket,
  getOrbRollover, bumpOrbRollover, type TicketRecord,
} from '../db/store';
import {
  scoreRace, TICKET_THRESHOLD, RACES_PER_COOKIE_PIECE, COOKIE_PIECES,
  type ScoreBreakdown,
} from './scoring';
import { buildTicket, type BuiltTicket } from '../megapot/numbers';
import { buyEarnedTickets, buyRandomTickets, SettlementInProgressError } from '../megapot/purchase';
import { getCurrentDrawing } from '../megapot/drawing';
import { NETWORK } from '../megapot/addresses';
import type { RaceOutcome } from '../game/types';

export type SettlementResult = {
  breakdown: ScoreBreakdown;
  placement: number;
  pointsAwarded: number;
  pointBank: number;
  pointBankBefore: number;
  lifetimePoints: number;
  racesCompleted: number;
  cookiePieces: number;
  cookieProgress: number; // 0..COOKIE_PIECES within the current cookie
  ticketsMinted: TicketRecord[];
  /** The ticket numbers the race produced, shown even when no ticket was bought. */
  previewTicket: BuiltTicket | null;
  /** Populated when the chain call failed; the run still counts for points. */
  purchaseError: string | null;
  orbRollover: number;
};

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
  if (race.settledAt) {
    throw new Error('Race already settled');
  }
  if (outcome.seed !== race.seed) {
    throw new Error('Outcome seed does not match the issued race seed');
  }

  const rollover = await getOrbRollover();
  const breakdowns = scoreRace(outcome, rollover);
  const mine = breakdowns.find((b) => b.racerId === playerId.toLowerCase() || b.racerId === playerId);
  if (!mine) throw new Error('Player not present in race outcome');

  const me = outcome.racers.find((r) => r.id === mine.racerId)!;

  // Orb rollover: stacks whenever nobody claimed it this race.
  const orbClaimed = outcome.racers.some((r) => r.hasOrb);
  const newRollover = await bumpOrbRollover(orbClaimed);

  // ── Update the player ────────────────────────────────────────────────────
  const player = await getOrCreatePlayer(playerId);
  const pointBankBefore = player.pointBank;

  const racesCompleted = player.racesCompleted + 1;
  const lifetimePoints = player.lifetimePoints + mine.total;
  let pointBank = player.pointBank + mine.total;

  const cookiePieces = Math.floor(racesCompleted / RACES_PER_COOKIE_PIECE);
  const cookiesDue = Math.floor(cookiePieces / COOKIE_PIECES);
  const newCookies = Math.max(0, cookiesDue - player.cookiesAwarded);

  // ── Work out what to buy ─────────────────────────────────────────────────
  const pointBankTickets = Math.floor(pointBank / TICKET_THRESHOLD);
  pointBank -= pointBankTickets * TICKET_THRESHOLD;

  // Numbers the player earned this race, valid against the live drawing.
  let previewTicket: BuiltTicket | null = null;
  let purchaseError: string | null = null;
  const ticketsMinted: TicketRecord[] = [];

  try {
    const drawing = await getCurrentDrawing();
    previewTicket = buildTicket(
      me.collectedNumbers,
      me.bonusball,
      drawing.ballMax,
      drawing.bonusballMax,
    );

    // Skill path — earned numbers.
    if (pointBankTickets > 0) {
      const tickets = Array.from({ length: Math.min(pointBankTickets, 10) }, () =>
        buildTicket(me.collectedNumbers, me.bonusball, drawing.ballMax, drawing.bonusballMax),
      );
      const res = await buyEarnedTickets(playerId as `0x${string}`, tickets);
      for (const [i, t] of tickets.entries()) {
        ticketsMinted.push(
          await recordTicket({
            id: `${res.txHash}-${i}`,
            playerId,
            txHash: res.txHash,
            drawingId: res.drawingId.toString(),
            normals: t.normals,
            bonusball: t.bonusball,
            earnedNormals: t.earnedNormals,
            filledNormals: t.filledNormals,
            bonusballEarned: t.bonusballEarned,
            path: 'point_bank',
            network: NETWORK,
          }),
        );
      }
    }

    // Consistency path — protocol-random numbers.
    if (newCookies > 0) {
      const res = await buyRandomTickets(playerId as `0x${string}`, Math.min(newCookies, 10));
      ticketsMinted.push(
        await recordTicket({
          id: `${res.txHash}-cookie`,
          playerId,
          txHash: res.txHash,
          drawingId: res.drawingId.toString(),
          normals: [],
          bonusball: 0,
          earnedNormals: [],
          filledNormals: [],
          bonusballEarned: false,
          path: 'cookie',
          network: NETWORK,
        }),
      );
    }
  } catch (err) {
    // A chain failure must never cost the player their run. Points are banked;
    // the ticket is owed and retried by /api/tickets/retry.
    purchaseError =
      err instanceof SettlementInProgressError
        ? 'Megapot is mid-settlement — your ticket is queued and will mint shortly.'
        : (err as Error).message;

    if (pointBankTickets > 0) pointBank += pointBankTickets * TICKET_THRESHOLD;
  }

  const ticketsActuallyBought = ticketsMinted.length;

  await updatePlayer(player.id, {
    pointBank,
    lifetimePoints,
    racesCompleted,
    cookiePieces,
    cookiesAwarded: purchaseError ? player.cookiesAwarded : player.cookiesAwarded + newCookies,
    totalStolen: player.totalStolen + me.steals,
    ticketsEarned: player.ticketsEarned + ticketsActuallyBought,
  });

  await settleRace(raceId, { placement: mine.placement, pointsAwarded: mine.total });

  return {
    breakdown: mine,
    placement: mine.placement,
    pointsAwarded: mine.total,
    pointBank,
    pointBankBefore,
    lifetimePoints,
    racesCompleted,
    cookiePieces,
    cookieProgress: cookiePieces % COOKIE_PIECES,
    ticketsMinted,
    previewTicket,
    purchaseError,
    orbRollover: newRollover,
  };
}
