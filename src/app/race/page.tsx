'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { RaceView } from '@/components/race/RaceView';
import { Results, type SettlementPayload } from '@/components/race/Results';
import { buildRacerSlots } from '@/lib/game/replay';
import type { InputLog } from '@/lib/game/replay';

type Phase = 'lobby' | 'racing' | 'submitting' | 'results';

type RaceSession = {
  raceId: string;
  seed: number;
  ballMax: number;
  bonusballMax: number;
  rolloverCount: number;
};

export default function RacePage() {
  const wallet = useWallet();
  const { jackpot } = useJackpot(60_000);

  const [phase, setPhase] = useState<Phase>('lobby');
  const [session, setSession] = useState<RaceSession | null>(null);
  const [result, setResult] = useState<SettlementPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const explorerBase =
    jackpot?.network === 'mainnet' ? 'https://basescan.org' : 'https://sepolia.basescan.org';

  // ── Start a race ─────────────────────────────────────────────────────────
  const startRace = useCallback(async () => {
    if (!wallet.address) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/race/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address, name: wallet.name }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Could not create a race');

      setSession({
        raceId: json.raceId,
        seed: json.seed,
        ballMax: json.ballMax,
        bonusballMax: json.bonusballMax,
        rolloverCount: json.rolloverCount,
      });
      setResult(null);
      setPhase('racing');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }, [wallet.address, wallet.name]);

  // ── Submit for server-side scoring ───────────────────────────────────────
  const onFinish = useCallback(
    async (inputs: InputLog) => {
      if (!session || !wallet.address) return;
      setPhase('submitting');
      try {
        const res = await fetch('/api/race/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raceId: session.raceId, address: wallet.address, inputs }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'Could not score the race');
        setResult(json as SettlementPayload);
        setPhase('results');
      } catch (e) {
        setError((e as Error).message);
        setPhase('lobby');
      }
    },
    [session, wallet.address],
  );

  return (
    <>
      <Nav address={wallet.address} name={wallet.name} />

      <main className="mx-auto max-w-6xl px-5 pb-16 pt-8">
        {error && (
          <div
            className="card mb-5 p-4 text-sm"
            style={{ borderColor: 'rgba(244,63,94,0.35)', color: '#fda4af' }}
          >
            {error}
          </div>
        )}

        {phase === 'lobby' && (
          <Lobby
            ready={wallet.ready && !!wallet.address}
            creating={creating}
            onStart={startRace}
            playerName={wallet.name}
            setName={wallet.setName}
            ballMax={jackpot?.ballMax}
            bonusballMax={jackpot?.bonusballMax}
          />
        )}

        {phase === 'racing' && session && (
          <RaceView
            raceId={session.raceId}
            seed={session.seed}
            ballMax={session.ballMax}
            bonusballMax={session.bonusballMax}
            humanName={wallet.name}
            onFinish={onFinish}
          />
        )}

        {phase === 'submitting' && (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)]" />
            <div className="text-center">
              <p className="font-semibold text-slate-200">Verifying your run…</p>
              <p className="mt-1 text-sm text-slate-500">
                Replaying the race server-side and checking your Point Bank.
              </p>
            </div>
          </div>
        )}

        {phase === 'results' && result && (
          <Results
            data={result}
            explorerBase={explorerBase}
            onRaceAgain={() => {
              setPhase('lobby');
              setSession(null);
              startRace();
            }}
          />
        )}
      </main>
    </>
  );
}

function Lobby({
  ready,
  creating,
  onStart,
  playerName,
  setName,
  ballMax,
  bonusballMax,
}: {
  ready: boolean;
  creating: boolean;
  onStart: () => void;
  playerName: string;
  setName: (n: string) => void;
  ballMax?: number;
  bonusballMax?: number;
}) {
  const [slots, setSlots] = useState<ReturnType<typeof buildRacerSlots>>([]);

  // Preview a plausible field so the lobby doesn't sit empty before the race exists.
  useEffect(() => {
    setSlots(buildRacerSlots('preview-lobby', playerName));
  }, [playerName]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-center">
        <h1
          className="text-3xl font-extrabold tracking-tight sm:text-4xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Ready up
        </h1>
        <p className="mt-2 text-slate-400">
          Five racers. A track nobody has seen. {ballMax ? `Shards carry 1–${ballMax}, the Orb carries 1–${bonusballMax}.` : ''}
        </p>
      </div>

      <div className="card p-6">
        <div className="chip mb-4">Lobby · 5 slots</div>

        <div className="space-y-2.5">
          {slots.map((s, i) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
            >
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: i === 0 ? 'var(--accent)' : ['#f472b6', '#60a5fa', '#c084fc', '#fb923c'][(i - 1) % 4],
                  boxShadow: i === 0 ? '0 0 12px rgba(52,211,153,0.7)' : 'none',
                }}
              />
              {i === 0 ? (
                <input
                  value={playerName}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={20}
                  className="flex-1 bg-transparent font-semibold text-slate-100 outline-none placeholder:text-slate-600"
                  placeholder="Your name"
                  aria-label="Your racer name"
                />
              ) : (
                <span className="flex-1 font-medium text-slate-300">{s.name}</span>
              )}
              <span className="chip">{i === 0 ? 'You' : s.skill}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Empty slots fill with bots so a race always starts instantly — the field is
          drawn fresh for every race.
        </p>

        <button
          onClick={onStart}
          disabled={!ready || creating}
          className="btn btn-primary mt-6 w-full py-4 text-base"
        >
          {creating ? 'Building your track…' : ready ? 'Start race' : 'Preparing your wallet…'}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Tip title="Steer" body="← → or A / D. On touch, drag anywhere on the track." />
        <Tip title="Boost" body="Space, twice per race. Save one for the run to the line." />
        <Tip title="Collect" body="Green Shards are numbers. Amber ones are traps — they duplicate a number you hold." />
      </div>
    </div>
  );
}

function Tip({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="text-sm font-bold text-slate-200">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}
