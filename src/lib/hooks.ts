'use client';

import { useCallback, useEffect, useState } from 'react';

export type Jackpot = {
  ok: boolean;
  network: string;
  chainId: number;
  jackpotAddress: string;
  drawingId: string;
  prizePoolFormatted: string;
  ticketPriceFormatted: string;
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
    pointBank: number;
    lifetimePoints: number;
    racesCompleted: number;
    cookiePieces: number;
    totalStolen: number;
    ticketsEarned: number;
  };
  tickets: Array<{
    id: string;
    txHash: string;
    drawingId: string;
    normals: number[];
    bonusball: number;
    earnedNormals: number[];
    filledNormals: number[];
    bonusballEarned: boolean;
    path: 'point_bank' | 'cookie';
    createdAt: string;
  }>;
  progress: {
    threshold: number;
    pointBankPct: number;
    cookieProgress: number;
    cookiePieces: number;
  };
};

export function usePlayer(address: string | null) {
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
  }, [load]);

  return { profile: data, loading, reload: load };
}
