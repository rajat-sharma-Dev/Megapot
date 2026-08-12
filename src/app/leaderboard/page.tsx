'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/lib/wallet/useWallet';
import { useLeaderboard } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { DayCountdown } from '@/components/DrawCountdown';
import { PoolMeter } from '@/components/Progress';
import { formatUsdc, shortAddress } from '@/lib/format';

type Tab = 'today' | 'allTime' | 'feared' | 'history';

export default function LeaderboardPage() {
  const wallet = useWallet();
  const { board, error } = useLeaderboard(12_000);
  const [tab, setTab] = useState<Tab>('today');

  const me = wallet.address?.toLowerCase();
  const day = board?.day;

  return (
    <>
      <Nav address={wallet.address} name={wallet.name} />

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="text-3xl font-extrabold tracking-tight sm:text-4xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Today&apos;s ladder
            </h1>
            {day && (
              <p className="mt-2 text-sm text-slate-400">
                Vault day <span className="num">{day.key}</span> · pays out in{' '}
                <DayCountdown closesAt={day.closesAt} className="font-bold" />
              </p>
            )}
          </div>
          <Link href="/race" className="btn btn-primary px-6 py-3">
            Race now
          </Link>
        </div>

        {error && (
          <div className="card mt-6 p-4 text-sm" style={{ borderColor: 'rgba(244,63,94,0.35)', color: '#fda4af' }}>
            {error}
          </div>
        )}

        {/* ── The pool ───────────────────────────────────────────────── */}
        {day && (
          <div className="card mt-6 p-6 rise">
            <PoolMeter
              poolUnits={day.poolUnits}
              ticketPriceUnits={day.ticketPriceUnits}
              projectedTickets={day.projectedTickets}
              entries={day.entries}
            />
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/[0.07] pt-5 sm:grid-cols-4">
              <Total label="Entry fee" value={formatUsdc(day.entryFeeUnits)} />
              <Total label="Ticket price" value={formatUsdc(day.ticketPriceUnits)} />
              <Total label="Rolled in" value={formatUsdc(day.carryInUnits)} />
              <Total label="Racers today" value={board!.today.length} />
            </div>
          </div>
        )}

        {/* ── Tabs ───────────────────────────────────────────────────── */}
        <div className="mt-6 flex flex-wrap gap-2">
          {([
            ['today', "Today"],
            ['allTime', 'All-time'],
            ['feared', 'Most feared'],
            ['history', 'Past payouts'],
          ] as Array<[Tab, string]>).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === key
                  ? 'bg-white/[0.1] text-white'
                  : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!board ? (
          <div className="mt-6 space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : (
          <div className="mt-6">
            {tab === 'today' && (
              board.today.length === 0 ? (
                <Empty>Nobody has raced today yet. The board is wide open.</Empty>
              ) : (
                <div className="stagger space-y-2">
                  {board.today.map((row) => (
                    <Row
                      key={row.address}
                      rank={row.rank}
                      name={row.name}
                      address={row.address}
                      isMe={row.address === me}
                      primary={row.points.toLocaleString()}
                      primaryLabel="pts"
                      meta={`${row.races} ${row.races === 1 ? 'race' : 'races'} · best ${row.bestScore}${
                        row.retired ? ` · ${row.retired} DNF` : ''
                      }`}
                      badge={row.projectedTickets > 0 ? `${row.projectedTickets} 🎟` : null}
                    />
                  ))}
                </div>
              )
            )}

            {tab === 'allTime' && (
              board.allTime.length === 0 ? (
                <Empty>No races recorded yet.</Empty>
              ) : (
                <div className="stagger space-y-2">
                  {board.allTime.map((row) => (
                    <Row
                      key={row.address}
                      rank={row.rank}
                      name={row.name}
                      address={row.address}
                      isMe={row.address === me}
                      primary={row.lifetimePoints.toLocaleString()}
                      primaryLabel="pts"
                      meta={`${row.racesCompleted} races · best ${row.bestRaceScore}`}
                      badge={row.ticketsEarned > 0 ? `${row.ticketsEarned} 🎟` : null}
                    />
                  ))}
                </div>
              )
            )}

            {tab === 'feared' && (
              board.feared.length === 0 ? (
                <Empty>No steals landed yet. Overtake a rival at a checkpoint to get on this board.</Empty>
              ) : (
                <div className="stagger space-y-2">
                  {board.feared.map((row) => (
                    <Row
                      key={row.address}
                      rank={row.rank}
                      name={row.name}
                      address={row.address}
                      isMe={row.address === me}
                      primary={row.steals.toLocaleString()}
                      primaryLabel="steals"
                      meta="Points taken from rivals at checkpoints"
                      badge={null}
                    />
                  ))}
                </div>
              )
            )}

            {tab === 'history' && (
              board.recentDays.length === 0 ? (
                <Empty>
                  No day has closed yet. The first payout lands at 17:00 UTC.
                </Empty>
              ) : (
                <div className="space-y-3">
                  {board.recentDays.map((d) => (
                    <div key={d.key} className="card p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="num text-sm font-bold text-slate-200">{d.key}</span>
                        <span className="chip chip-gold">{d.ticketsBought} tickets minted</span>
                      </div>
                      {d.winners.length === 0 ? (
                        <p className="mt-3 text-xs text-slate-500">
                          The pool didn&apos;t reach one full ticket — it rolled into the next day.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-1.5">
                          {d.winners.map((w) => (
                            <div
                              key={w.address}
                              className="flex items-center gap-3 text-sm"
                            >
                              <span className="num w-6 text-slate-500">#{w.rank}</span>
                              <span className="flex-1 truncate text-slate-300">{w.name}</span>
                              <span className="num font-bold text-[var(--gold)]">
                                {w.tickets} 🎟
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="mt-3 text-xs text-slate-600">
                        {d.entries} entries pooled
                      </p>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {board && (
          <div className="mt-8 grid grid-cols-3 gap-3">
            <Total label="Racers" value={board.totals.players} />
            <Total label="Races" value={board.totals.races} />
            <Total label="Tickets minted" value={board.totals.ticketsMinted} />
          </div>
        )}
      </main>
    </>
  );
}

function Row({
  rank, name, address, isMe, primary, primaryLabel, meta, badge,
}: {
  rank: number;
  name: string;
  address: string;
  isMe: boolean;
  primary: string;
  primaryLabel: string;
  meta: string;
  badge: string | null;
}) {
  const medal = rank === 1 ? 'var(--gold)' : rank === 2 ? '#cbd5e1' : rank === 3 ? '#d97706' : null;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        isMe
          ? 'you-row border-[var(--accent)]/40 bg-[var(--accent)]/[0.06]'
          : 'border-white/[0.07] bg-white/[0.02]'
      }`}
    >
      <span
        className="num w-8 shrink-0 text-center text-sm font-extrabold"
        style={{ color: medal ?? 'var(--text-faint)' }}
      >
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-slate-100">{name}</span>
          {isMe && <span className="chip chip-live">you</span>}
        </div>
        <div className="num mt-0.5 truncate text-[11px] text-slate-600">
          {shortAddress(address)} · {meta}
        </div>
      </div>

      {badge && <span className="chip chip-gold shrink-0">{badge}</span>}

      <div className="shrink-0 text-right">
        <div className="num text-lg font-extrabold text-slate-100">{primary}</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-600">{primaryLabel}</div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="card p-10 text-center text-sm text-slate-500">{children}</div>
  );
}

function Total({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-4 text-center">
      <div className="num text-xl font-extrabold text-slate-100">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="stat-label mt-1">{label}</div>
    </div>
  );
}
