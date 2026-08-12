'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { RaceView } from '@/components/race/RaceView';
import { Results, type SettlementPayload } from '@/components/race/Results';
import { DayCountdown } from '@/components/DrawCountdown';
import { buildRacerSlots } from '@/lib/game/replay';
import { formatUsdc } from '@/lib/format';
import type { InputLog } from '@/lib/game/replay';

type Phase = 'lobby' | 'racing' | 'submitting' | 'results';

type RaceSession = {
  raceId: string;
  seed: number;
  rolloverCount: number;
};

export default function RacePage() {
  const wallet = useWallet();
  const { jackpot } = useJackpot(60_000);
  const { profile, refresh } = usePlayer(wallet.address);

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
        refresh();
      } catch (e) {
        setError((e as Error).message);
        setPhase('lobby');
      }
    },
    [session, wallet.address, refresh],
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
            entriesLeft={profile?.credits.entriesAffordable ?? null}
            entryFeeUnits={profile?.credits.entryFeeUnits ?? null}
            rank={profile?.today.rank ?? null}
            dayPoints={profile?.today.points ?? 0}
            projected={profile?.today.projectedTickets ?? 0}
            closesAt={profile?.today.closesAt}
          />
        )}

        {phase === 'racing' && session && (
          <RaceView
            raceId={session.raceId}
            seed={session.seed}
            humanName={wallet.name}
            rolloverCount={session.rolloverCount}
            onFinish={onFinish}
          />
        )}

        {phase === 'submitting' && (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)]" />
            <div className="text-center">
              <p className="font-semibold text-slate-200">Verifying your run…</p>
              <p className="mt-1 text-sm text-slate-500">
                Replaying the race server-side to score it.
              </p>
            </div>
          </div>
        )}

        {phase === 'results' && result && (
          <Results
            data={result}
            explorerBase={explorerBase}
            entriesLeft={profile?.credits.entriesAffordable ?? null}
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
  entriesLeft,
  entryFeeUnits,
  rank,
  dayPoints,
  projected,
  closesAt,
}: {
  ready: boolean;
  creating: boolean;
  onStart: () => void;
  playerName: string;
  setName: (n: string) => void;
  entriesLeft: number | null;
  entryFeeUnits: string | null;
  rank: number | null;
  dayPoints: number;
  projected: number;
  closesAt?: string;
}) {
  const [slots, setSlots] = useState<ReturnType<typeof buildRacerSlots>>([]);

  // Preview a plausible field so the lobby doesn't sit empty before the race exists.
  useEffect(() => {
    setSlots(buildRacerSlots('preview-lobby', playerName));
  }, [playerName]);

  const broke = entriesLeft !== null && entriesLeft <= 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-center rise">
        <h1
          className="text-3xl font-extrabold tracking-tight sm:text-4xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Ready up
        </h1>
        <p className="mt-2 text-slate-400">
          Five racers. A track nobody has seen. Collect cells for points, cans for boost.
        </p>
      </div>

      {/* Where you stand today — the reason to run another race. */}
      <div className="card mb-5 grid grid-cols-2 gap-4 p-5 sm:grid-cols-4 rise">
        <Metric label="Today's rank" value={rank ? `#${rank}` : '—'} accent />
        <Metric label="Today's points" value={dayPoints.toLocaleString()} />
        <Metric label="Projected tickets" value={projected} gold={projected > 0} />
        <div>
          <div className="stat-label">Day closes</div>
          <div className="num mt-1 text-lg font-bold text-slate-200">
            {closesAt ? <DayCountdown closesAt={closesAt} /> : '—'}
          </div>
        </div>
      </div>

      <div className="card p-6 rise" style={{ animationDelay: '80ms' }}>
        <div className="mb-4 flex items-center justify-between">
          <div className="chip">Lobby · 5 slots</div>
          <div className="chip chip-cyan">
            Entry {entryFeeUnits ? formatUsdc(entryFeeUnits) : '—'}
            {entriesLeft !== null && ` · ${entriesLeft} left today`}
          </div>
        </div>

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
          drawn fresh every time.
        </p>

        <button
          onClick={onStart}
          disabled={!ready || creating || broke}
          className="btn btn-primary mt-6 w-full py-4 text-base"
        >
          {creating
            ? 'Building your track…'
            : broke
              ? 'Out of entries — resets at 17:00 UTC'
              : ready
                ? 'Race now'
                : 'Preparing your wallet…'}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Tip title="Steer" body="← → or A / D. On touch, drag anywhere on the track." />
        <Tip
          title="Boost"
          body="Hold Space. It burns fuel and works even while stunned — it's how you recover from a hit."
        />
        <Tip
          title="Collect"
          body="Green hexes are points. Cyan cans are fuel. Amber hexes are traps — they cost you."
        />
      </div>
    </div>
  );
}

function Metric({
  label, value, accent, gold,
}: { label: string; value: string | number; accent?: boolean; gold?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div
        className={`num mt-1 text-lg font-bold ${
          gold ? 'text-[var(--gold)]' : accent ? 'text-[var(--accent)]' : 'text-slate-200'
        }`}
      >
        {value}
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
