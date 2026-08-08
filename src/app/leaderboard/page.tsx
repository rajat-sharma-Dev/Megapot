'use client';

import { useEffect, useState } from 'react';
import { useWallet, shortAddress } from '@/lib/wallet/useWallet';
import { Nav } from '@/components/Nav';

type Board = {
  ok: boolean;
  points: Array<{
    rank: number; address: string; name: string;
    lifetimePoints: number; racesCompleted: number; ticketsEarned: number;
  }>;
  feared: Array<{ rank: number; address: string; name: string; steals: number }>;
  totals: { players: number; races: number; ticketsMinted: number };
};

export default function LeaderboardPage() {
  const wallet = useWallet();
  const [board, setBoard] = useState<Board | null>(null);
  const [tab, setTab] = useState<'points' | 'feared'>('points');

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((j) => j.ok && setBoard(j))
      .catch(() => {});
  }, []);

  const me = wallet.address?.toLowerCase();

  return (
    <>
      <Nav address={wallet.address} name={wallet.name} />

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-10">
        <h1
          className="text-3xl font-extrabold tracking-tight sm:text-4xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Leaderboard
        </h1>

        {board && (
          <div className="mt-6 grid grid-cols-3 gap-3">
            <Total label="Racers" value={board.totals.players} />
            <Total label="Races run" value={board.totals.races} />
            <Total label="Tickets minted" value={board.totals.ticketsMinted} gold />
          </div>
        )}

        <div className="mt-8 flex gap-2">
          <TabBtn active={tab === 'points'} onClick={() => setTab('points')}>
            Lifetime points
          </TabBtn>
          <TabBtn active={tab === 'feared'} onClick={() => setTab('feared')}>
            Most Feared Racer
          </TabBtn>
        </div>

        <div className="card mt-4 overflow-hidden">
          {!board ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.04]" />
              ))}
            </div>
          ) : tab === 'points' ? (
            board.points.length === 0 ? (
              <Empty text="No races yet — be the first on the board." />
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {board.points.map((r) => (
                  <Row
                    key={r.address}
                    rank={r.rank}
                    name={r.name}
                    address={r.address}
                    isMe={r.address === me}
                    primary={`${r.lifetimePoints.toLocaleString()} pts`}
                    secondary={`${r.racesCompleted} races · ${r.ticketsEarned} tickets`}
                  />
                ))}
              </div>
            )
          ) : board.feared.length === 0 ? (
            <Empty text="No steals landed yet. Overtake someone at a checkpoint." />
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {board.feared.map((r) => (
                <Row
                  key={r.address}
                  rank={r.rank}
                  name={r.name}
                  address={r.address}
                  isMe={r.address === me}
                  primary={`${r.steals} steals`}
                  secondary="points taken from rivals"
                  violet
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function Row({
  rank, name, address, primary, secondary, isMe, violet,
}: {
  rank: number; name: string; address: string;
  primary: string; secondary: string; isMe?: boolean; violet?: boolean;
}) {
  const medal = rank === 1 ? 'var(--gold)' : rank === 2 ? '#cbd5e1' : rank === 3 ? '#d97706' : undefined;

  return (
    <div
      className="flex items-center gap-4 px-5 py-3.5"
      style={isMe ? { background: 'rgba(52,211,153,0.06)' } : undefined}
    >
      <div
        className="num w-8 text-center text-lg font-extrabold"
        style={{ color: medal ?? 'var(--text-faint)' }}
      >
        {rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-slate-100">
          {name}
          {isMe && <span className="ml-2 text-xs font-bold text-[var(--accent)]">you</span>}
        </div>
        <div className="num text-xs text-slate-600">{shortAddress(address)}</div>
      </div>
      <div className="text-right">
        <div
          className="num font-bold"
          style={{ color: violet ? 'var(--violet)' : 'var(--accent)' }}
        >
          {primary}
        </div>
        <div className="text-xs text-slate-600">{secondary}</div>
      </div>
    </div>
  );
}

function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
        active ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  );
}

function Total({ label, value, gold }: { label: string; value: number; gold?: boolean }) {
  return (
    <div className="card p-4">
      <div className="stat-label">{label}</div>
      <div className={`num mt-1 text-2xl font-extrabold ${gold ? 'text-[var(--gold)]' : 'text-slate-100'}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-slate-500">{text}</div>;
}
