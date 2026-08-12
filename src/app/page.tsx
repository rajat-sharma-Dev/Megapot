'use client';

import Link from 'next/link';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer } from '@/lib/hooks';
import { useSound } from '@/lib/audio/SoundProvider';
import { Nav } from '@/components/Nav';
import { DemoRace } from '@/components/DemoRace';
import { JackpotPanel } from '@/components/JackpotPanel';
import { ShardMeter } from '@/components/ShardMeter';
import { formatUsdc } from '@/lib/format';

export default function Home() {
  const wallet = useWallet();
  const { jackpot, error } = useJackpot();
  const { profile } = usePlayer(wallet.address);
  const { play } = useSound();

  const fee = jackpot?.economy.entryFeeUnits;
  const pot = jackpot?.economy.fullPotUnits;

  return (
    <>
      <Nav profile={profile} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-white/[0.06]">
        <DemoRace className="opacity-[0.34]" />
        {/* The race behind the type has to lose the fight with the type. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_20%_50%,rgba(4,6,12,0.96),rgba(4,6,12,0.72)_55%,transparent)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#04060c] to-transparent" />

        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-5 sm:pb-28 sm:pt-24">
          <div className="chip chip-live rise mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
            Live on {jackpot?.network === 'mainnet' ? 'Base' : 'Base Sepolia'}
          </div>

          <h1
            className="display rise max-w-4xl text-[2.6rem] leading-[0.95] sm:text-7xl lg:text-8xl"
            style={{ animationDelay: '60ms' }}
          >
            FIVE RACERS.
            <br />
            <span className="text-[var(--gold)] glow-gold">ONE REAL TICKET.</span>
          </h1>

          <p
            className="rise mt-6 max-w-xl text-lg leading-relaxed text-slate-300"
            style={{ animationDelay: '130ms' }}
          >
            Everyone stakes a fifth of a Megapot lottery ticket. One driver takes the whole pot —
            and it isn&apos;t whoever crosses the line first. It&apos;s whoever{' '}
            <span className="font-semibold text-white">scores</span> most.
          </p>

          <div
            className="rise mt-9 flex flex-wrap items-center gap-3"
            style={{ animationDelay: '200ms' }}
          >
            <Link
              href="/play"
              onClick={() => play('confirm')}
              className="btn btn-primary px-8 py-4 text-base"
            >
              Enter a race
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <a href="#how" onClick={() => play('click')} className="btn btn-ghost px-6 py-4 text-base">
              How it works
            </a>
          </div>

          {/* The economy in one line, live. */}
          <div
            className="rise mt-10 flex flex-wrap items-center gap-x-7 gap-y-3 text-sm"
            style={{ animationDelay: '270ms' }}
          >
            <Fact label="Entry" value={fee ? formatUsdc(fee) : '—'} tone="accent" />
            <Fact label="Full pot" value={pot ? formatUsdc(pot) : '—'} tone="gold" />
            <Fact
              label="Jackpot"
              value={jackpot ? `$${jackpot.prizePoolFormatted}` : '—'}
              tone="gold"
            />
            <Fact label="Race length" value="~70s" />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-5">
        {/* ── The one rule that makes this a game ────────────────────────── */}
        <section className="mt-14">
          <div className="panel panel-lit overflow-hidden p-7 sm:p-9">
            <div className="chip chip-violet mb-5">The rule</div>
            <h2 className="display max-w-2xl text-2xl leading-tight sm:text-4xl">
              Winning the sprint is not winning the race.
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-slate-400">
              Finish position is worth points, and it is worth a lot of them — but a full run scores
              around 140, and the gap between first and third is 35. One good section of point cells
              covers it. So the driver who blasted to the front through an empty lane loses to the
              driver who came third and swept the track.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <ScoreCard
                place="1st"
                verdict="loses the pot"
                tone="loser"
                rows={[
                  ['Point cells', 40],
                  ['Finish + position', 85],
                  ['Clean run', 0],
                  ['Afterburner', 6],
                ]}
                total={131}
              />
              <ScoreCard
                place="3rd"
                verdict="takes the pot"
                tone="winner"
                rows={[
                  ['Point cells', 90],
                  ['Finish + position', 50],
                  ['Clean run', 20],
                  ['Afterburner', 11],
                ]}
                total={171}
              />
            </div>

            <p className="mt-6 text-sm text-slate-500">
              Which is why every race stays live to the last corner: nobody knows who won until the
              scores land.
            </p>
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────────── */}
        <section id="how" className="mt-8 scroll-mt-24">
          <div className="panel panel-lit p-7 sm:p-9">
            <div className="chip chip-gold mb-5">How it works</div>
            <h2 className="display text-2xl leading-tight sm:text-4xl">
              Five stakes in. One ticket out.
            </h2>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Step
                n="01"
                title="Deposit"
                body="Connect your wallet and send USDC. It's a plain transfer — no approvals, no custom contract, and you can withdraw it whenever you like."
              />
              <Step
                n="02"
                title="Get matched"
                body="Five seats, filled at random from whoever is queueing. Empty seats are taken by the house, which stakes its own float and races to keep it."
              />
              <Step
                n="03"
                title="Race"
                body="~70 seconds. Collect point cells, refill your boost tank, dodge traps, claim the orb, and steal at the checkpoints."
              />
              <Step
                n="04"
                title="Take the pot"
                body="Highest score takes every shard staked. Five shards is a whole Megapot ticket, minted straight to your wallet."
                tone="gold"
              />
            </div>

            {/* Shard maths, drawn rather than described. */}
            <div className="inset mt-7 p-6">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <div className="eyebrow">The shard maths</div>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                    An entry costs exactly a fifth of a ticket, so a full five-seat pot{' '}
                    <span className="text-slate-200">is</span> a ticket. Win one and it mints
                    immediately. Win a smaller pot and the shards stack until they make a whole one —
                    nothing is ever rounded away.
                  </p>
                </div>
                <div className="w-full max-w-[220px]">
                  <ShardMeter shards={5} perTicket={5} size="lg" />
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="num text-slate-500">
                      {fee ? formatUsdc(fee) : '—'} × 5
                    </span>
                    <span className="display font-semibold text-[var(--gold)]">= 1 ticket 🎟</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── What's on the track ────────────────────────────────────────── */}
        <section className="mt-8">
          <div className="panel p-7 sm:p-9">
            <div className="chip mb-5">On the track</div>
            <h2 className="display text-2xl leading-tight sm:text-3xl">
              Everything that changes your score
            </h2>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Legend color="var(--accent)" title="Point cells" body="+10 each. The main currency, and the reason to take the harder line." />
              <Legend color="var(--cyan)" title="Fuel cans" body="+32 fuel. Boost is a tank, not a charge — no cans, no comeback." />
              <Legend color="#f59e0b" title="Score traps" body="−12. They look like point cells. Grabbing blindly costs you." />
              <Legend color="var(--gold)" title="Jackpot Orb" body="80+, one claimant only — and it pays nothing unless you carry it to the line. Unclaimed, it rolls over and grows." />
              <Legend color="var(--violet)" title="Steal zones" body="Overtake at a checkpoint and take 15 points off the racer you passed." />
              <Legend color="var(--danger)" title="Hard barriers" body="Stun, lost speed, and a quarter of your fuel tank spilled." />
            </div>
          </div>
        </section>

        {/* ── Live chain state ───────────────────────────────────────────── */}
        <section className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          <JackpotPanel jackpot={jackpot} error={error} />

          <div className="panel p-7">
            <div className="chip mb-5">Real tickets, not points</div>
            <p className="text-sm leading-relaxed text-slate-400">
              A shard vault that fills buys a ticket from Megapot&apos;s own contract, with the
              protocol picking the numbers and the ticket NFT minted directly to your address. The
              treasury never holds it, so there is nothing to trust and nothing to claim later —
              it&apos;s in your wallet the moment it exists.
            </p>

            {jackpot && (
              <div className="mt-6 grid gap-4 border-t border-white/[0.07] pt-5 sm:grid-cols-2">
                <div>
                  <div className="stat-label">Jackpot contract</div>
                  <a
                    href={`https://${jackpot.network === 'mainnet' ? '' : 'sepolia.'}basescan.org/address/${jackpot.jackpotAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num mt-1 block truncate text-xs text-[var(--accent)] hover:underline"
                  >
                    {jackpot.jackpotAddress}
                  </a>
                </div>
                <div>
                  <div className="stat-label">Ball pool this round</div>
                  <div className="num mt-1 text-xs text-slate-300">
                    normals 1–{jackpot.ballMax} · bonusball 1–{jackpot.bonusballMax}
                  </div>
                </div>
                <div>
                  <div className="stat-label">House float</div>
                  <div className="num mt-1 text-xs text-slate-300">
                    {formatUsdc(jackpot.economy.houseFloatUnits)} — what the house has to lose
                  </div>
                </div>
                <div>
                  <div className="stat-label">Network</div>
                  <div className="mt-1 text-xs text-slate-300">
                    {jackpot.network === 'mainnet' ? 'Base mainnet' : 'Base Sepolia'} · chain{' '}
                    <span className="num">{jackpot.chainId}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Close ──────────────────────────────────────────────────────── */}
        <section className="mt-12">
          <div className="panel panel-lit panel-gold relative overflow-hidden p-9 text-center">
            <div className="absolute inset-x-0 top-0 h-px shimmer" />
            <h2 className="display text-2xl leading-tight sm:text-4xl">
              The cheapest way to get a Megapot ticket
              <br />
              <span className="text-[var(--gold)]">is to be good at getting one.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-400">
              Buying direct costs you a whole ticket. Racing costs a fifth of one and gives you a
              shot at the other four.
            </p>
            <Link
              href="/play"
              onClick={() => play('confirm')}
              className="btn btn-gold mt-7 px-9 py-4 text-base"
            >
              Take a seat
            </Link>
          </div>
        </section>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-7 text-xs text-slate-600">
          <span>
            Built on{' '}
            <a
              href="https://docs.megapot.io"
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-slate-200"
            >
              Megapot
            </a>{' '}
            — on-chain lottery on Base.
          </span>
          <span>
            Play responsibly. This awards real lottery tickets where the network is mainnet.
          </span>
        </footer>
      </main>
    </>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'accent' | 'gold';
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="stat-label">{label}</span>
      <span
        className={`num font-bold ${
          tone === 'gold'
            ? 'text-[var(--gold)]'
            : tone === 'accent'
              ? 'text-[var(--accent)]'
              : 'text-slate-200'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  tone,
}: {
  n: string;
  title: string;
  body: string;
  tone?: 'gold';
}) {
  return (
    <div className="panel-hover rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <div
        className={`num text-xs font-bold ${tone === 'gold' ? 'text-[var(--gold)]' : 'text-[var(--accent)]'}`}
      >
        {n}
      </div>
      <div className="display mt-2 font-semibold text-slate-100">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}

function Legend({ color, title, body }: { color: string; title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div
        className="mt-1 h-3 w-3 shrink-0 rotate-45 rounded-[3px]"
        style={{ background: color, boxShadow: `0 0 14px ${color}` }}
      />
      <div>
        <div className="display text-sm font-semibold text-slate-100">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{body}</p>
      </div>
    </div>
  );
}

/**
 * The two score sheets side by side.
 *
 * Numbers chosen to be representative rather than cherry-picked: 40 points of
 * cells is four of the seven-to-ten on a track, and 90 is nine of them.
 */
function ScoreCard({
  place,
  verdict,
  rows,
  total,
  tone,
}: {
  place: string;
  verdict: string;
  rows: Array<[string, number]>;
  total: number;
  tone: 'winner' | 'loser';
}) {
  const winner = tone === 'winner';
  return (
    <div
      className={`rounded-2xl border p-5 ${
        winner
          ? 'border-[var(--gold)]/40 bg-[var(--gold)]/[0.05]'
          : 'border-white/[0.07] bg-white/[0.02]'
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="display text-2xl font-bold text-slate-100">{place}</span>
        <span className={`chip ${winner ? 'chip-gold' : ''}`}>{verdict}</span>
      </div>

      <div className="mt-4 space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{label}</span>
            <span className={`num ${value === 0 ? 'text-slate-600' : 'text-slate-200'}`}>
              +{value}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.07] pt-3">
        <span className="display text-sm font-semibold text-slate-200">Total</span>
        <span
          className={`num text-2xl font-bold ${winner ? 'text-[var(--gold)]' : 'text-slate-300'}`}
        >
          {total}
        </span>
      </div>
    </div>
  );
}
