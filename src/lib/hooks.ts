'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoreBreakdown } from './points/scoring';

/** Live Megapot state plus the economy derived from it. */
export type Jackpot = {
  ok: boolean;
  network: string;
  chainId: number;
  jackpotAddress: string;
  usdcAddress: `0x${string}`;
  treasuryAddress: `0x${string}` | null;
  depositsEnabled: boolean;

  drawingId: string;
  prizePool: string;
  prizePoolFormatted: string;
  ticketPrice: string;
  ticketPriceFormatted: string;
  /** Live per-drawing ball ranges. We don't pick numbers, but they're worth showing. */
  ballMax: number;
  bonusballMax: number;
  ticketsBought: string;
  drawingTimeMs: number;
  jackpotLock: boolean;
  referralFeePct: number;
  referralWinSharePct: number;

  economy: {
    seatsPerRace: number;
    entryFeeUnits: string;
    fullPotUnits: string;
    minDepositUnits: string;
    houseFloatUnits: string;
  };
};

export function useJackpot(pollMs = 25_000) {
  const [data, setData] = useState<Jackpot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/jackpot');
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Failed to read the jackpot');
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { jackpot: data, error, reload: load };
}

export type RaceHistoryRow = {
  lobbyId: string;
  settledAt: string;
  points: number;
  placement: number | null;
  retired: boolean | null;
  won: boolean;
  potUnits: string;
  stakedSeats: number;
  winnerName: string | null;
  houseWins: boolean;
  ticketsMinted: number;
};

export type PlayerProfile = {
  ok: boolean;
  player: {
    id: string;
    name: string;
    racesPlayed: number;
    racesWon: number;
    racesRetired: number;
    lifetimePoints: number;
    bestRaceScore: number;
    totalStolen: number;
    ticketsEarned: number;
    createdAt: string;
  };
  balance: {
    creditsUnits: string;
    entriesAffordable: number;
    entryFeeUnits: string;
    lifetimeDepositedUnits: string;
    lifetimeWithdrawnUnits: string;
    lifetimeWageredUnits: string;
    lifetimeWonUnits: string;
  };
  economy: {
    seatsPerRace: number;
    ticketPriceUnits: string;
  };
  tickets: Array<{
    id: string;
    txHash: string;
    drawingId: string;
    count: number;
    lobbyId: string | null;
    network: string;
    createdAt: string;
    explorerUrl: string;
  }>;
  ledger: Array<{
    id: string;
    kind: string;
    deltaUnits: string;
    txHash: string | null;
    lobbyId: string | null;
    note: string | null;
    createdAt: string;
    explorerUrl: string | null;
  }>;
  history: RaceHistoryRow[];
};

export function usePlayer(address: string | null, pollMs = 0) {
  const [data, setData] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/player?address=${address}`);
      const json = await res.json();
      if (json.ok) setData(json);
    } catch {
      // Leave the last good profile on screen rather than blanking the HUD.
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { profile: data, loading, refresh: load };
}

// ─── Lobbies ────────────────────────────────────────────────────────────────

export type SeatView = {
  index: number;
  kind: 'human' | 'bot' | 'empty';
  /** Simulation id — `house_<i>` for bots, `seat_<i>` for humans. Never an address. */
  id: string;
  name: string;
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

export type StandingRow = {
  index: number;
  id: string;
  name: string;
  kind: 'human' | 'bot';
  points: number;
  placement: number;
  retired: boolean;
  progress: number;
  isWinner: boolean;
};

export type LobbySettlementView = {
  settledAt: string;
  winnerSeat: number | null;
  winnerId: string | null;
  winnerName: string | null;
  winnerKind: 'human' | 'bot' | null;
  potUnits: string;
  stakedSeats: number;
  houseWins: boolean;
  refunded: boolean;
  standings: StandingRow[];
  ticketsMinted: number;
  txHashes: string[];
  mintError: string | null;
};

export type LobbyView = {
  id: string;
  state: 'open' | 'locked' | 'settled';
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
  potUnits: string;
  seatsTotal: number;
  mySeat: number | null;
  mySubmitted: boolean;
  myBreakdown: ScoreBreakdown | null;
  settlement: LobbySettlementView | null;
};

/**
 * Poll a lobby while it matchmakes or resolves.
 *
 * Polling stops on its own once the lobby settles, so a results screen left open
 * doesn't hammer the API forever. The interval is short because this endpoint is
 * also what *advances* lobbies — a slow poll is a slow race start.
 */
export function useLobby(
  lobbyId: string | null,
  address: string | null,
  opts: { pollMs?: number; enabled?: boolean } = {},
) {
  const { pollMs = 1500, enabled = true } = opts;
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  const load = useCallback(async () => {
    if (!lobbyId) return null;
    try {
      const url = `/api/lobby/${lobbyId}${address ? `?address=${address}` : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Lobby unavailable');
      setLobby(json.lobby);
      setError(null);
      return json.lobby as LobbyView;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [lobbyId, address]);

  useEffect(() => {
    if (!lobbyId || !enabled) return;
    stopped.current = false;

    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await load();
      if (stopped.current) return;
      // Nothing changes after settlement — stop asking.
      if (next?.state === 'settled') return;
      timer = setTimeout(tick, pollMs);
    };
    tick();

    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [lobbyId, enabled, pollMs, load]);

  return { lobby, error, reload: load, setLobby };
}

// ─── High scores ────────────────────────────────────────────────────────────

export type RecentWinner = {
  lobbyId: string;
  settledAt: string;
  name: string;
  isHouse: boolean;
  points: number;
  wonFromBehind: boolean;
  placement: number;
  potUnits: string;
  stakedSeats: number;
  ticketsMinted: number;
};

export type RecentFeed = {
  ok: boolean;
  winners: RecentWinner[];
  totals: { races: number; humanWins: number; ticketsMinted: number; potUnits: string };
};

/** The attract screen's high score table. */
export function useRecentWinners(pollMs = 30_000) {
  const [data, setData] = useState<RecentFeed | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/recent');
      const json = await res.json();
      if (json.ok) setData(json);
    } catch {
      // The board is decoration until somebody has raced — never worth an error.
    }
  }, []);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { recent: data, reload: load };
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export type TicketNumbers = { normals: number[]; bonusball: number };

export type TicketRow = {
  id: string;
  txHash: string;
  drawingId: string;
  count: number;
  lobbyId: string | null;
  network: string;
  createdAt: string;
  simulated: boolean;
  ticketIds: string[];
  /** The actual lottery numbers, when the Data API knows them. */
  numbers: TicketNumbers[];
  /** Null for a simulated purchase — there is no transaction to open. */
  explorerUrl: string | null;
};

export type TicketsFeed = {
  ok: boolean;
  local: TicketRow[];
  totalTickets: number;
  realTickets: number;
  simulatedTickets: number;
  dryRun: boolean;
  onchainError: string | null;
};

/**
 * A wallet's tickets, with their numbers.
 *
 * Separate from `usePlayer` because it joins Megapot's Data API, which is slower
 * and allowed to fail — a ticket list that can't load should not take the whole
 * profile down with it.
 */
export function useTickets(address: string | null, pollMs = 0) {
  const [data, setData] = useState<TicketsFeed | null>(null);

  const load = useCallback(async () => {
    if (!address) {
      setData(null);
      return;
    }
    try {
      const res = await fetch(`/api/tickets?address=${address}`);
      const json = await res.json();
      if (json.ok) setData(json);
    } catch {
      // Keep the last good list rather than blanking it.
    }
  }, [address]);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { tickets: data, refresh: load };
}

/** A 1Hz clock shared by every countdown on a page, so eight of them cost one timer. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
