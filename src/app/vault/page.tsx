'use client';

import Link from 'next/link';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { DepositPanel } from '@/components/wallet/DepositPanel';
import { WithdrawPanel } from '@/components/wallet/WithdrawPanel';
import { VaultCard } from '@/components/ShardMeter';
import { ClaimWinnings } from '@/components/wallet/ClaimWinnings';
import { formatUsdc } from '@/lib/format';
import { shortAddress } from '@/lib/wallet/useWallet';

/**
 * The vault: money in, money out, shards, tickets, and the ledger behind all of
 * it.
 *
 * The ledger is not an afterthought. This app takes real deposits and awards
 * real lottery tickets, so every movement of value gets a row a player can read
 * and, where it touched the chain, a transaction they can open.
 */
export default function VaultPage() {
  const wallet = useWallet();
  const { jackpot } = useJackpot(30_000);
  const { profile, refresh } = usePlayer(wallet.address, 20_000);

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

  if (!wallet.isConnected) {
    return (
      <>
        <Nav />
        <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center gap-6 px-5 text-center">
          <h1 className="display text-3xl">Connect to see your vault</h1>
          <p className="text-slate-400">
            Balances, shards and tickets all live against your wallet address.
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

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-5">
        <div className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Your vault</div>
            <h1 className="display mt-1 text-3xl sm:text-4xl">{profile?.player.name ?? '—'}</h1>
            <div className="num mt-1 text-xs text-slate-500">{shortAddress(wallet.address)}</div>
          </div>
          <Link href="/play" className="btn btn-primary px-6 py-3">
            Race now
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
          {/* ── Money ─────────────────────────────────────────────────── */}
          <div className="space-y-5">
            <div className="panel panel-lit rise p-6">
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
                />
              </div>
            </div>

            {profile && (
              <VaultCard
                shards={profile.vault.shards}
                perTicket={profile.vault.shardsPerTicket}
                vaultUnits={profile.vault.units}
                ticketPriceUnits={profile.vault.ticketPriceUnits}
                ticketsEarned={profile.player.ticketsEarned}
              />
            )}

            <div className="panel rise p-6">
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

            <div className="panel panel-lit panel-gold rise p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="chip chip-gold">Megapot tickets</div>
                <span className="num text-xs text-slate-500">
                  {profile?.tickets.reduce((s, t) => s + t.count, 0) ?? 0} total
                </span>
              </div>

              {!profile?.tickets.length ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  No tickets yet. Fill five shards and one mints itself.
                </p>
              ) : (
                <div className="stagger space-y-2">
                  {profile.tickets.slice(0, 8).map((t) => (
                    <a
                      key={t.id}
                      href={t.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-[var(--gold)]/25 bg-[var(--gold)]/[0.05] px-3.5 py-2.5 transition-colors hover:bg-[var(--gold)]/[0.1]"
                    >
                      <span className="text-lg">🎟</span>
                      <div className="min-w-0 flex-1">
                        <div className="display text-sm font-semibold text-[var(--gold)]">
                          {t.count} ticket{t.count === 1 ? '' : 's'} · round {t.drawingId}
                        </div>
                        <div className="num truncate text-[11px] text-slate-500">{t.txHash}</div>
                      </div>
                      <span className="text-xs text-slate-600">↗</span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="panel rise p-6">
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

            <div className="panel rise p-6">
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
