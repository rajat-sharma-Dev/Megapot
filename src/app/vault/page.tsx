'use client';

import Link from 'next/link';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer, useTickets } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { DepositPanel } from '@/components/wallet/DepositPanel';
import { WithdrawPanel } from '@/components/wallet/WithdrawPanel';
import { ClaimWinnings } from '@/components/wallet/ClaimWinnings';
import { formatUsdc } from '@/lib/format';
import type { TicketRow } from '@/lib/hooks';
import { shortAddress } from '@/lib/wallet/useWallet';

/**
 * The vault: money in, money out, tickets, and the ledger behind all of it.
 *
 * The ledger is not an afterthought. This app takes real deposits and awards
 * real lottery tickets, so every movement of value gets a row a player can read
 * and, where it touched the chain, a transaction they can open.
 */
export default function VaultPage() {
  const wallet = useWallet();
  const { jackpot } = useJackpot(30_000);
  const { profile, refresh } = usePlayer(wallet.address, 20_000);
  const { tickets } = useTickets(wallet.address, 30_000);

  // Spin only while a previous session is still being restored. `settled`
  // is false on the server and on the first client render, so this branch
  // hydrates cleanly, and it is timeout-bounded so a stalled reconnect
  // falls through to the connect screen instead of hanging here.
  if (!wallet.isConnected && !wallet.settled) {
    return (
      <>
        <Nav />
        <main className="mx-auto grid min-h-[70vh] max-w-6xl place-items-center px-5">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)]" />
        </main>
      </>
    );
  }

  if (!wallet.isConnected) {
    return (
      <>
        <Nav />
        <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center gap-6 px-5 text-center">
          <h1 className="display text-3xl">Connect to see your vault</h1>
          <p className="text-slate-400">
            Your balance and tickets all live against your wallet address.
          </p>
          <ConnectButton />
        </main>
      </>
    );
  }

  const wins = profile?.history.filter((h) => h.won).length ?? 0;
  const winRate =
    profile && profile.player.racesPlayed > 0
      ? Math.round((profile.player.racesWon / profile.player.racesPlayed) * 100)
      : 0;

  return (
    <>
      <Nav profile={profile} />

      <main className="mx-auto max-w-6xl px-3 pb-20 pt-6 sm:px-5 sm:pt-8">
        <div className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Your vault</div>
            <h1 className="display mt-1 text-2xl sm:text-4xl">{profile?.player.name ?? '—'}</h1>
            <div className="num mt-1 text-xs text-slate-500">{shortAddress(wallet.address)}</div>
          </div>
          <Link href="/play" className="btn btn-primary px-6 py-3">
            Race now
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
          {/* ── Money ─────────────────────────────────────────────────── */}
          <div className="space-y-5">
            <div className="panel panel-lit rise p-4 sm:p-6">
              <div className="flex items-baseline justify-between">
                <div className="eyebrow">Spendable balance</div>
                <span className="num text-xs text-slate-500">
                  {profile?.balance.entriesAffordable ?? 0} entries
                </span>
              </div>
              <div className="num mt-2 text-4xl font-bold text-[var(--accent)] glow-accent">
                {formatUsdc(profile?.balance.creditsUnits ?? '0')}
              </div>

              <div className="mt-6 border-t border-white/[0.07] pt-5">
                <DepositPanel jackpot={jackpot} onCredited={refresh} />
              </div>

              <div className="mt-6 border-t border-white/[0.07] pt-5">
                <WithdrawPanel
                  creditsUnits={profile?.balance.creditsUnits ?? '0'}
                  onWithdrawn={refresh}
                  withdrawalsEnabled={!!jackpot?.depositsEnabled}
                />
              </div>
            </div>

            <div className="panel panel-lit panel-gold rise p-4 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="eyebrow">Tickets won</div>
                  <div className="num mt-1 text-4xl font-bold text-[var(--gold)] glow-gold">
                    {profile?.player.ticketsEarned ?? 0}
                  </div>
                </div>
                <div className="text-right">
                  <div className="stat-label">Pots taken</div>
                  <div className="num mt-1 text-2xl font-bold text-slate-100">
                    {profile?.player.racesWon ?? 0}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Win a race and its pot buys a Megapot ticket outright, minted straight to your
                wallet. Anything too small to buy one goes back to your balance.
              </p>
            </div>

            <div className="panel rise p-4 sm:p-6">
              <div className="eyebrow mb-4">Career</div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2">
                <Stat label="Races" value={profile?.player.racesPlayed ?? 0} />
                <Stat label="Pots won" value={profile?.player.racesWon ?? 0} accent />
                <Stat label="Win rate" value={`${winRate}%`} />
                <Stat label="Best score" value={profile?.player.bestRaceScore ?? 0} />
                <Stat label="Points" value={profile?.player.lifetimePoints ?? 0} />
                <Stat label="Steals landed" value={profile?.player.totalStolen ?? 0} />
                <Stat
                  label="Wagered"
                  value={formatUsdc(profile?.balance.lifetimeWageredUnits ?? '0')}
                />
                <Stat
                  label="Won"
                  value={formatUsdc(profile?.balance.lifetimeWonUnits ?? '0')}
                  gold
                />
              </div>
            </div>
          </div>

          {/* ── Tickets, races, ledger ───────────────────────────────── */}
          <div className="space-y-5">
            {/* Renders nothing until this wallet has actually won something. */}
            <ClaimWinnings onClaimed={refresh} />

            <div className="panel panel-lit panel-gold rise p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="chip chip-gold">Megapot tickets</div>
                <span className="num text-xs text-slate-500">
                  {tickets?.totalTickets ?? 0} total
                </span>
              </div>

              {/*
                Simulation is disclosed here, not discovered on BaseScan. A
                dry-run purchase broadcasts nothing, so it has no numbers and no
                transaction — a player who wins one is owed the reason.
              */}
              {tickets?.dryRun && (
                <div className="mb-4 border border-[var(--gold)]/35 bg-[var(--gold)]/[0.07] p-3">
                  <div className="display text-xs font-bold text-[var(--gold)]">
                    Simulation mode
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    Purchases are being simulated against live chain state, not broadcast, so these
                    tickets have no numbers and no transaction to open. Set{' '}
                    <span className="num">MEGAPOT_DRY_RUN=false</span> with a funded treasury to buy
                    real ones.
                  </p>
                </div>
              )}

              {!tickets?.local.length ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  No tickets yet. Win a pot and one mints to your wallet.
                </p>
              ) : (
                <div className="stagger space-y-2">
                  {tickets.local.slice(0, 8).map((t) => (
                    <TicketRowView key={t.id} ticket={t} />
                  ))}
                </div>
              )}
            </div>

            <div className="panel rise p-4 sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="chip">Recent races</div>
                <span className="text-xs text-slate-500">{wins} won</span>
              </div>

              {!profile?.history.length ? (
                <p className="py-6 text-center text-sm text-slate-500">No races yet.</p>
              ) : (
                <div className="stagger space-y-2">
                  {profile.history.slice(0, 10).map((h) => (
                    <div
                      key={h.lobbyId}
                      className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                        h.won
                          ? 'border-[var(--gold)]/35 bg-[var(--gold)]/[0.06]'
                          : 'border-white/[0.07] bg-white/[0.02]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="display text-sm font-semibold text-slate-200">
                          {h.won ? `Took the pot — ${formatUsdc(h.potUnits)}` : `Lost to ${h.winnerName ?? 'the field'}`}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {h.retired ? 'DNF' : `P${h.placement}`} ·{' '}
                          {new Date(h.settledAt).toLocaleString()}
                        </div>
                      </div>
                      <span className="num text-sm font-bold text-slate-100">{h.points}</span>
                      {h.ticketsMinted > 0 && <span className="chip chip-gold">🎟</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel rise p-4 sm:p-6">
              <div className="chip mb-4">Ledger</div>
              {!profile?.ledger.length ? (
                <p className="py-6 text-center text-sm text-slate-500">Nothing has moved yet.</p>
              ) : (
                <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                  {profile.ledger.map((e) => {
                    const delta = BigInt(e.deltaUnits);
                    const positive = delta > 0n;
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2"
                      >
                        <span className="chip shrink-0">{e.kind}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-slate-400">{e.note ?? '—'}</div>
                          <div className="text-[10px] text-slate-600">
                            {new Date(e.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <span
                          className={`num text-sm font-bold ${
                            positive ? 'text-[var(--accent)]' : 'text-slate-400'
                          }`}
                        >
                          {positive ? '+' : '−'}
                          {formatUsdc(positive ? delta : -delta, { symbol: false })}
                        </span>
                        {e.explorerUrl && (
                          <a
                            href={e.explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-slate-600 hover:text-slate-300"
                          >
                            ↗
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

/**
 * One ticket.
 *
 * The numbers are the ticket. Everything else — the hash, the round, which pot
 * paid for it — is provenance, so the numbers lead and the rest is small. When
 * there are no numbers to show, the row says why instead of leaving a gap.
 */
function TicketRowView({ ticket }: { ticket: TicketRow }) {
  const body = (
    <>
      <span className="shrink-0 text-lg">🎟</span>
      <div className="min-w-0 flex-1">
        {ticket.numbers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {ticket.numbers[0].normals.map((n, i) => (
              <span
                key={i}
                className="num grid h-6 w-6 place-items-center rounded-sm bg-white/10 text-[11px] font-bold text-slate-100"
              >
                {n}
              </span>
            ))}
            <span className="num grid h-6 w-6 place-items-center rounded-full bg-[var(--gold)] text-[11px] font-bold text-black">
              {ticket.numbers[0].bonusball}
            </span>
            {ticket.count > 1 && (
              <span className="ml-1 text-[10px] text-slate-500">+{ticket.count - 1} more</span>
            )}
          </div>
        ) : (
          <div className="display text-sm font-semibold text-[var(--gold)]">
            {ticket.count} ticket{ticket.count === 1 ? '' : 's'}
            {ticket.simulated && (
              <span className="ml-2 text-[10px] font-normal text-slate-500">
                simulated — no numbers assigned
              </span>
            )}
          </div>
        )}
        <div className="num mt-1 truncate text-[10px] text-slate-600">
          round {ticket.drawingId}
          {ticket.ticketIds.length > 0 && ` · #${ticket.ticketIds[0]}`}
        </div>
      </div>
      {ticket.explorerUrl ? (
        <span className="shrink-0 text-xs text-slate-600">↗</span>
      ) : (
        <span className="chip shrink-0 text-[9px]">sim</span>
      )}
    </>
  );

  const className =
    'flex items-center gap-3 border border-[var(--gold)]/25 bg-[var(--gold)]/[0.05] px-3.5 py-2.5 transition-colors' +
    (ticket.explorerUrl ? ' hover:bg-[var(--gold)]/[0.1]' : '');

  // No link when there is no transaction — a dead explorer tab reads as a
  // broken promise about a ticket that was never bought.
  return ticket.explorerUrl ? (
    <a href={ticket.explorerUrl} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Stat({
  label,
  value,
  accent,
  gold,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  gold?: boolean;
}) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div
        className={`num mt-1 text-xl font-bold ${
          gold ? 'text-[var(--gold)]' : accent ? 'text-[var(--accent)]' : 'text-slate-100'
        }`}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
