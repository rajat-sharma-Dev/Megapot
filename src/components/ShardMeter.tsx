'use client';

import { formatUsdc } from '@/lib/format';

/**
 * The shard vault.
 *
 * Five cells, one per shard, because five shards are one Megapot ticket. This is
 * the single clearest statement of the whole economy in the product, so it is
 * drawn literally rather than as a percentage bar: you can count what you have
 * and count what's missing.
 *
 * `justWon` lights the cells that landed in the race you just finished, which is
 * the difference between "here is a number" and "here is what you just did".
 */
export function ShardMeter({
  shards,
  perTicket = 5,
  justWon = 0,
  size = 'md',
}: {
  shards: number;
  perTicket?: number;
  justWon?: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  // Only the progress toward the NEXT ticket is shown — a full set converts
  // immediately, so a vault is never sitting on five.
  const filled = ((shards % perTicket) + perTicket) % perTicket;
  const heights = { sm: 'h-2', md: 'h-3', lg: 'h-4' } as const;

  return (
    <div className="shard-row" role="img" aria-label={`${filled} of ${perTicket} shards`}>
      {Array.from({ length: perTicket }, (_, i) => {
        const isFull = i < filled;
        const isNew = isFull && i >= filled - justWon;
        return (
          <div
            key={i}
            className={`shard ${heights[size]} ${isFull ? 'shard-full' : ''} ${
              isNew ? 'shard-new' : ''
            }`}
            style={isNew ? { animationDelay: `${(i - (filled - justWon)) * 110}ms` } : undefined}
          />
        );
      })}
    </div>
  );
}

/**
 * The vault headline: how close this wallet is to its next real ticket.
 */
export function VaultCard({
  shards,
  perTicket,
  vaultUnits,
  ticketPriceUnits,
  justWon = 0,
  ticketsEarned,
}: {
  shards: number;
  perTicket: number;
  vaultUnits: string;
  ticketPriceUnits: string;
  justWon?: number;
  ticketsEarned?: number;
}) {
  const remaining = perTicket - (shards % perTicket);

  return (
    <div className="panel panel-lit panel-gold p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Shard vault</div>
          <div className="num mt-1 text-4xl font-bold text-[var(--gold)] glow-gold">
            {shards % perTicket}
            <span className="text-xl text-slate-600">/{perTicket}</span>
          </div>
        </div>
        {typeof ticketsEarned === 'number' && (
          <div className="text-right">
            <div className="stat-label">Tickets won</div>
            <div className="num mt-1 text-2xl font-bold text-slate-100">{ticketsEarned}</div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <ShardMeter shards={shards} perTicket={perTicket} justWon={justWon} size="lg" />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        {remaining === perTicket ? (
          <>
            Win a pot to start a ticket. A full five-seat pot completes one on its own.
          </>
        ) : (
          <>
            <span className="num text-slate-300">{remaining}</span> more{' '}
            {remaining === 1 ? 'shard' : 'shards'} and a real Megapot ticket is minted straight to
            your wallet. Holding{' '}
            <span className="num text-slate-300">{formatUsdc(vaultUnits)}</span> against a{' '}
            <span className="num text-slate-300">{formatUsdc(ticketPriceUnits)}</span> ticket.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The pot for the race in front of you.
 *
 * Shown as seats rather than as money, because "four of five seats are staked"
 * is the fact that decides whether a win completes a whole ticket.
 */
export function PotMeter({
  potUnits,
  entryFeeUnits,
  stakedSeats,
  seatsTotal,
  compact,
}: {
  potUnits: string;
  entryFeeUnits: string;
  stakedSeats: number;
  seatsTotal: number;
  compact?: boolean;
}) {
  const pot = BigInt(potUnits || '0');
  const fee = BigInt(entryFeeUnits || '0');
  const pct = seatsTotal > 0 ? (stakedSeats / seatsTotal) * 100 : 0;
  const full = stakedSeats >= seatsTotal;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="stat-label">Pot on the line</span>
        <span className="num text-xs text-slate-500">
          {stakedSeats}/{seatsTotal} seats staked
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="num shrink-0 text-2xl font-bold text-[var(--gold)]">
          {formatUsdc(pot)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="bar-grow h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${pct}%`,
                background: full
                  ? 'linear-gradient(90deg, var(--gold-deep), #ffe08a)'
                  : 'linear-gradient(90deg, var(--gold-deep), var(--gold))',
                boxShadow: '0 0 14px rgba(255,197,61,0.55)',
              }}
            />
          </div>
        </div>
      </div>

      {!compact && (
        <p className="mt-2 text-xs text-slate-500">
          {full ? (
            <span className="text-[var(--gold)]">
              Full house — the winner takes a whole ticket immediately.
            </span>
          ) : (
            <>
              <span className="num text-slate-400">{formatUsdc(fee)}</span> per seat ·{' '}
              winner takes all {stakedSeats} shards
            </>
          )}
        </p>
      )}
    </div>
  );
}
