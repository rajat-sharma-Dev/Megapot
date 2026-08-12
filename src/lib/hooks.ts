'use client';

import { useCallback, useEffect, useState } from 'react';

export type Jackpot = {
  ok: boolean;
  network: string;
  chainId: number;
  jackpotAddress: string;
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
};

/** Live Megapot drawing state, refreshed on an interval. */
export function useJackpot(pollMs = 20_000) {
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
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { jackpot: data, error, reload: load };
}

export type PlayerProfile = {
  ok: boolean;
  player: {
    id: string;
    name: string;
    credits: string;
    lifetimePoints: number;
    racesCompleted: number;
    racesRetired: number;
    bestRaceScore: number;
    totalStolen: number;
    ticketsEarned: number;
  };
  tickets: Array<{
    id: string;
    txHash: string;
    drawingId: string;
    count: number;
    dayKey: string;
    rank: number;
    points: number;
    network: string;
    createdAt: string;
  }>;
  credits: {
    units: string;
    entriesAffordable: number;
    entryFeeUnits: string;
    freeEntriesPerDay: number;
  };
  today: {
    key: string;
    closesAt: string;
    rank: number | null;
    players: number;
    points: number;
    races: number;
    bestScore: number;
    projectedTickets: number;
    pointsToNextRank: number | null;
    poolUnits: string;
    projectedTicketsTotal: number;
  };
};

export function usePlayer(address: string | null, pollMs = 0) {
  const [data, setData] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/player?address=${address}`);
      const json = await res.json();
      if (json.ok) setData(json);
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

  return { profile: data, loading, reload: load, refresh: load };
}

export type LadderRow = {
  rank: number;
  address: string;
  name: string;
  points: number;
  races: number;
  bestScore: number;
  retired: number;
  projectedTickets: number;
};

export type Leaderboard = {
  ok: boolean;
  day: {
    key: string;
    opensAt: string;
    closesAt: string;
    entries: number;
    poolUnits: string;
    carryInUnits: string;
    projectedTickets: number;
    remainderUnits: string;
    ticketPriceUnits: string;
    entryFeeUnits: string;
    entriesPerTicket: number;
    settled: boolean;
  };
  today: LadderRow[];
  allTime: Array<{
    rank: number;
    address: string;
    name: string;
    lifetimePoints: number;
    racesCompleted: number;
    bestRaceScore: number;
    ticketsEarned: number;
  }>;
  feared: Array<{ rank: number; address: string; name: string; steals: number }>;
  recentDays: Array<{
    key: string;
    ticketsBought: number;
    entries: number;
    winners: Array<{ rank: number; name: string; address: string; tickets: number }>;
  }>;
  totals: { players: number; races: number; ticketsMinted: number };
};

export function useLeaderboard(pollMs = 15_000) {
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard');
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Failed to load the boards');
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

  return { board: data, error, reload: load };
}
