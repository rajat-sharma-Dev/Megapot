'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer, useLobby } from '@/lib/hooks';
import { useSound } from '@/lib/audio/SoundProvider';
import { Nav } from '@/components/Nav';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { DepositPanel } from '@/components/wallet/DepositPanel';
import { RaceView } from '@/components/race/RaceView';
import { Matchmaking } from '@/components/race/Matchmaking';
import { Results } from '@/components/race/Results';
import { ShardMeter, PotMeter } from '@/components/ShardMeter';
import { DemoRace } from '@/components/DemoRace';
import { formatUsdc } from '@/lib/format';
import type { InputLog } from '@/lib/game/replay';

type Phase = 'ready' | 'queue' | 'racing' | 'submitting' | 'results';

/**
 * The play loop.
 *
 * Five phases, and the transitions between them are all driven by lobby state
 * rather than by local flags — a lobby that locks starts the race, a lobby that
 * settles shows the result. That means a player who refreshes mid-queue, or
 * opens a second tab, sees the truth rather than a stale local guess.
 */
export default function PlayPage() {
  const wallet = useWallet();
  const { jackpot } = useJackpot(30_000);
  const { profile, refresh } = usePlayer(wallet.address);
  const { play, engine } = useSound();

  const [phase, setPhase] = useState<Phase>('ready');
  const [lobbyId, setLobbyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const startedRef = useRef<string | null>(null);

  const { lobby, reload: reloadLobby } = useLobby(lobbyId, wallet.address, {
    // Stop polling while the race itself is on screen: the outcome is local
    // until it's submitted, and a poll can't tell us anything we don't know.
    enabled: phase === 'queue' || phase === 'submitting' || phase === 'results',
  });

  const explorerBase =
    jackpot?.network === 'mainnet' ? 'https://basescan.org' : 'https://sepolia.basescan.org';

  const balance = profile ? BigInt(profile.balance.creditsUnits) : 0n;
  const entryFee = jackpot ? BigInt(jackpot.economy.entryFeeUnits) : 0n;
  const canAfford = entryFee > 0n && balance >= entryFee;

  // ── Queue → race ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'queue' || !lobby) return;
    if (lobby.state === 'open' || lobby.seed === null || lobby.mySeat === null) return;
    if (startedRef.current === lobby.id) return;

    startedRef.current = lobby.id;
    setPhase('racing');
  }, [phase, lobby]);

  // ── Music only while the player is in the flow ───────────────────────────
  useEffect(() => {
    if (phase === 'queue' || phase === 'racing') engine.startMusic();
    else engine.stopMusic();
    return () => engine.stopMusic();
  }, [phase, engine]);

  // ── Join ─────────────────────────────────────────────────────────────────
  const joinRace = useCallback(async () => {
    if (!wallet.address) return;
    setJoining(true);
    setError(null);
    play('confirm');

    try {
      const res = await fetch('/api/lobby/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address, name: wallet.name }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Could not join a race');

      startedRef.current = null;
      setLobbyId(json.lobby.id);
      setPhase('queue');
      refresh();
    } catch (e) {
      setError((e as Error).message);
      play('error');
    } finally {
      setJoining(false);
    }
  }, [wallet.address, wallet.name, refresh, play]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const onFinish = useCallback(
    async (inputs: InputLog) => {
      if (!lobbyId || !wallet.address) return;
      setPhase('submitting');

      try {
        const res = await fetch('/api/lobby/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lobbyId, address: wallet.address, inputs }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'Could not score the race');

        setPhase('results');
        await reloadLobby();
        refresh();
      } catch (e) {
        setError((e as Error).message);
        setPhase('results');
      }
    },
    [lobbyId, wallet.address, reloadLobby, refresh],
  );

  const raceAgain = useCallback(() => {
    setLobbyId(null);
    setPhase('ready');
    setError(null);
    joinRace();
  }, [joinRace]);

  // ── Gates ────────────────────────────────────────────────────────────────
  if (!wallet.ready) {
    return (
      <>
        <Nav />
        <main className="mx-auto grid min-h-[70vh] max-w-6xl place-items-center px-5">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)]" />
        </main>
      </>
    );
  }

  if (!wallet.isConnected) return <ConnectGate />;

  return (
    <>
      <Nav profile={profile} />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-5">
        {error && (
          <div className="panel mb-5 border-[var(--danger)]/35 p-4 text-sm text-[#ffb3c1]">
            {error}
          </div>
        )}

        {wallet.wrongNetwork && (
          <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 border-[var(--danger)]/35 p-4">
            <span className="text-sm text-[#ffb3c1]">
              Your wallet is on the wrong network. Rally Vault runs on {wallet.chainLabel}.
            </span>
            <button onClick={wallet.switchToTarget} className="btn btn-danger px-4 py-2 text-sm">
              Switch network
            </button>
          </div>
        )}

        {phase === 'ready' && (
          <ReadyRoom
            canAfford={canAfford}
            joining={joining}
            onJoin={joinRace}
            entryFeeUnits={jackpot?.economy.entryFeeUnits ?? '0'}
            fullPotUnits={jackpot?.economy.fullPotUnits ?? '0'}
            balanceUnits={profile?.balance.creditsUnits ?? '0'}
            entriesLeft={profile?.balance.entriesAffordable ?? 0}
            shards={profile?.vault.shards ?? 0}
            shardsPerTicket={profile?.vault.shardsPerTicket ?? 5}
            name={wallet.name}
            setName={wallet.setName}
            jackpot={jackpot}
            onDeposited={refresh}
          />
        )}

        {phase === 'queue' && lobby && <Matchmaking lobby={lobby} />}

        {phase === 'racing' && lobby && lobby.seed !== null && lobby.mySeat !== null && (
          <RaceView
            lobbyId={lobby.id}
            seed={lobby.seed}
            seats={lobby.seats}
            mySeatIndex={lobby.mySeat}
            rolloverCount={lobby.rolloverCount}
            potUnits={lobby.potUnits}
            onFinish={onFinish}
          />
        )}

        {phase === 'submitting' && <Verifying />}

        {phase === 'results' && lobby && (
          <Results
            lobby={lobby}
            profile={profile}
            explorerBase={explorerBase}
            canRaceAgain={canAfford}
            onRaceAgain={raceAgain}
          />
        )}
      </main>
    </>
  );
}

/** Not connected: nothing works, so say so once and get out of the way. */
function ConnectGate() {
  return (
    <>
      <Nav />
      <main className="relative mx-auto flex min-h-[78vh] max-w-2xl flex-col items-center justify-center px-5 text-center">
        <DemoRace className="opacity-[0.2]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_50%,rgba(4,6,12,0.95),rgba(4,6,12,0.75))]" />

        <div className="relative rise">
          <div className="chip chip-live mx-auto mb-5">Step one</div>
          <h1 className="display text-3xl sm:text-5xl">Connect your wallet</h1>
          <p className="mx-auto mt-4 max-w-md leading-relaxed text-slate-400">
            Your wallet is your account, your balance, and the address every Megapot ticket you win
            is minted to. Nothing is held on our side.
          </p>
          <div className="mt-8 flex justify-center">
            <ConnectButton />
          </div>
          <Link href="/" className="mt-6 inline-block text-sm text-slate-500 hover:text-slate-300">
            ← How the game works
          </Link>
        </div>
      </main>
    </>
  );
}

function Verifying() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)]" />
      <div>
        <p className="display font-semibold text-slate-200">Verifying your run…</p>
        <p className="mt-1 text-sm text-slate-500">
          Every seat is replayed server-side before a single shard moves.
        </p>
      </div>
    </div>
  );
}

/**
 * The ready room.
 *
 * Two jobs: make the stake unmistakable before it is spent, and put the deposit
 * panel one scroll away from the button that needs it, so "out of balance" is
 * never a dead end.
 */
function ReadyRoom({
  canAfford, joining, onJoin, entryFeeUnits, fullPotUnits, balanceUnits, entriesLeft,
  shards, shardsPerTicket, name, setName, jackpot, onDeposited,
}: {
  canAfford: boolean;
  joining: boolean;
  onJoin: () => void;
  entryFeeUnits: string;
  fullPotUnits: string;
  balanceUnits: string;
  entriesLeft: number;
  shards: number;
  shardsPerTicket: number;
  name: string;
  setName: (n: string) => void;
  jackpot: ReturnType<typeof useJackpot>['jackpot'];
  onDeposited: () => void;
}) {
  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[1.25fr_1fr]">
      <div className="panel panel-lit rise p-7">
        <div className="chip chip-live mb-4">Ready room</div>
        <h1 className="display text-3xl leading-tight sm:text-4xl">Take a seat</h1>
        <p className="mt-3 max-w-md leading-relaxed text-slate-400">
          One stake, five seats, seventy seconds. Highest score takes every shard on the table —
          and it is score, not finishing order, that decides it.
        </p>

        <div className="mt-6">
          <label className="stat-label" htmlFor="racer-name">
            Your racer name
          </label>
          <input
            id="racer-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="Racer"
            className="display mt-2 w-full rounded-xl border border-white/[0.09] bg-black/30 px-4 py-3 font-semibold text-slate-100 outline-none transition-colors focus:border-[var(--accent)]/60"
          />
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4 border-t border-white/[0.07] pt-5">
          <Metric label="Your stake" value={formatUsdc(entryFeeUnits)} tone="cyan" />
          <Metric label="Full pot" value={formatUsdc(fullPotUnits)} tone="gold" />
          <Metric label="Entries left" value={String(entriesLeft)} />
        </div>

        <button
          onClick={onJoin}
          disabled={!canAfford || joining}
          className="btn btn-primary mt-6 w-full py-4 text-base"
        >
          {joining
            ? 'Finding a lobby…'
            : canAfford
              ? `Stake ${formatUsdc(entryFeeUnits)} and race`
              : 'Deposit USDC to race'}
        </button>

        {!canAfford && (
          <p className="mt-3 text-center text-xs text-[var(--gold)]">
            Your balance is {formatUsdc(balanceUnits)} — one entry costs{' '}
            {formatUsdc(entryFeeUnits)}.
          </p>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Tip title="Steer" body="← → or A / D. On touch, drag anywhere on the track." />
          <Tip
            title="Boost"
            body="Hold Space. It burns fuel and works through a stun — it's how you recover from a hit."
          />
          <Tip
            title="Collect"
            body="Green cells are points. Cyan cans are fuel. Amber cells are traps."
          />
        </div>
      </div>

      <div className="space-y-5">
        <div className="panel panel-lit panel-gold rise p-6" style={{ animationDelay: '80ms' }}>
          <div className="flex items-baseline justify-between">
            <div className="eyebrow">Shard vault</div>
            <span className="num text-sm font-bold text-[var(--gold)]">
              {shards % shardsPerTicket}/{shardsPerTicket}
            </span>
          </div>
          <div className="mt-3">
            <ShardMeter shards={shards} perTicket={shardsPerTicket} size="lg" />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            {shardsPerTicket - (shards % shardsPerTicket)} more and a real Megapot ticket mints to
            your wallet.
          </p>

          <div className="mt-5 border-t border-white/[0.07] pt-5">
            <PotMeter
              potUnits={fullPotUnits}
              entryFeeUnits={entryFeeUnits}
              stakedSeats={5}
              seatsTotal={5}
              compact
            />
            <p className="mt-2 text-xs text-slate-500">
              What a full five-seat lobby is worth — exactly one ticket.
            </p>
          </div>
        </div>

        <div className="panel rise p-6" style={{ animationDelay: '140ms' }}>
          <div className="mb-4 flex items-baseline justify-between">
            <div className="eyebrow">Balance</div>
            <span className="num text-lg font-bold text-[var(--accent)]">
              {formatUsdc(balanceUnits)}
            </span>
          </div>
          <DepositPanel jackpot={jackpot} onCredited={onDeposited} />
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'gold' | 'cyan';
}) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div
        className={`num mt-1 text-lg font-bold ${
          tone === 'gold'
            ? 'text-[var(--gold)]'
            : tone === 'cyan'
              ? 'text-[var(--cyan)]'
              : 'text-slate-200'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Tip({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="display text-sm font-semibold text-slate-200">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}
