/**
 * Lobby → client view.
 *
 * One place decides what a browser is allowed to know about a race, which is
 * mostly a question about the seed: it is withheld until the lobby locks, so a
 * player cannot pull the track early, study it, and then take a seat. Once the
 * race has started there is nothing secret left — the track is on the screen.
 *
 * Addresses are trimmed to a display form for everyone except the requester.
 */

import type { Lobby, SeatRecord } from '../db/store';
import { toUnits } from '../db/store';
import { SEATS_PER_RACE } from './economy';

export type SeatView = {
  index: number;
  kind: 'human' | 'bot' | 'empty';
  /**
   * A simulation id for this seat, safe to publish.
   *
   * Bot seats keep their real `house_<i>` id because the client rebuilds their
   * controllers from it. Human seats get `seat_<i>` instead of an address: the
   * engine never reads an id semantically, so any distinct label simulates
   * identically, and there is no reason to hand every player in a lobby every
   * other player's wallet.
   */
  id: string;
  name: string;
  /** Only ever the requester's own address; rivals are shown short. */
  address: string | null;
  shortAddress: string | null;
  skill?: string;
  botSeed?: number;
  staked: boolean;
  submitted: boolean;
  isYou: boolean;
  points: number | null;
  placement: number | null;
  retired: boolean | null;
};

export type LobbyView = {
  id: string;
  state: Lobby['state'];
  /** Null until the lobby locks — see the note at the top of this file. */
  seed: number | null;
  createdAt: string;
  fillDeadline: string;
  submitDeadline: string | null;
  entryFeeUnits: string;
  ticketPriceUnits: string;
  drawingId: string;
  rolloverCount: number;
  seats: SeatView[];
  humans: number;
  bots: number;
  stakedSeats: number;
  /** Everything currently in the pot, in base units. */
  potUnits: string;
  seatsTotal: number;
  mySeat: number | null;
  mySubmitted: boolean;
  /** The requester's own score sheet, once the lobby has been scored. */
  myBreakdown: SeatRecord['breakdown'];
  settlement: Lobby['settlement'];
};

const short = (a: string) => (a && a.startsWith('0x') ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function seatView(seat: SeatRecord, viewer: string | null): SeatView {
  const isYou = seat.kind === 'human' && !!viewer && seat.id === viewer;
  return {
    index: seat.index,
    kind: seat.kind,
    id: seat.kind === 'bot' ? seat.id : `seat_${seat.index}`,
    name: seat.name,
    address: isYou ? seat.id : null,
    shortAddress: seat.kind === 'human' ? short(seat.id) : null,
    skill: seat.skill,
    botSeed: seat.botSeed,
    staked: seat.staked,
    submitted: !!seat.submittedAt,
    isYou,
    points: seat.points,
    placement: seat.placement,
    retired: seat.retired,
  };
}

export function toLobbyView(lobby: Lobby, viewerAddress?: string | null): LobbyView {
  const viewer = viewerAddress ? viewerAddress.toLowerCase() : null;
  const seats = lobby.seats.map((s) => seatView(s, viewer));
  const mine = seats.find((s) => s.isYou) ?? null;
  const staked = lobby.seats.filter((s) => s.staked).length;

  return {
    id: lobby.id,
    state: lobby.state,
    seed: lobby.state === 'open' ? null : lobby.seed,
    createdAt: lobby.createdAt,
    fillDeadline: lobby.fillDeadline,
    submitDeadline: lobby.submitDeadline,
    entryFeeUnits: lobby.entryFeeUnits,
    ticketPriceUnits: lobby.ticketPriceUnits,
    drawingId: lobby.drawingId,
    rolloverCount: lobby.rolloverCount,
    seats,
    humans: lobby.seats.filter((s) => s.kind === 'human').length,
    bots: lobby.seats.filter((s) => s.kind === 'bot').length,
    stakedSeats: staked,
    potUnits: (toUnits(lobby.entryFeeUnits) * BigInt(staked)).toString(),
    seatsTotal: SEATS_PER_RACE,
    mySeat: mine?.index ?? null,
    mySubmitted: mine?.submitted ?? false,
    myBreakdown:
      (mine && lobby.seats.find((s) => s.index === mine.index)?.breakdown) || null,
    settlement: lobby.settlement,
  };
}
