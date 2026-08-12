/**
 * Proof that the Megapot layer talks to the real protocol correctly.
 *
 *   npx tsx scripts/verify-megapot.ts
 *
 * Reads live drawing state from BOTH Base mainnet and Base Sepolia, checks the
 * Data API, confirms the contract we actually buy through exposes the signature
 * we call, and derives the vault economy from the live ticket price on each
 * network. No transactions, no spending — read-only.
 */

import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { ADDRESSES } from '../src/lib/megapot/addresses';
import { JACKPOT_ABI, RANDOM_TICKET_BUYER_ABI } from '../src/lib/megapot/abi';
import { formatUsdc, type DrawingState } from '../src/lib/megapot/drawing';
// The drawing helper truncates to cents, which renders a $0.002 Sepolia entry fee
// as "$0.00". The display formatter keeps significant digits, so the economy
// section uses that instead.
import { formatUsdc as formatPrecise } from '../src/lib/format';
import {
  entryFeeUnits, vaultToTickets, SHARDS_PER_TICKET, SEATS_PER_RACE,
} from '../src/lib/vault/economy';

const NETWORKS = [
  { name: 'Base Mainnet', chain: base, rpc: 'https://mainnet.base.org', addrs: ADDRESSES.mainnet },
  { name: 'Base Sepolia', chain: baseSepolia, rpc: 'https://sepolia.base.org', addrs: ADDRESSES.testnet },
] as const;

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => { failures++; console.log(`  \x1b[31m✗ ${m}\x1b[0m`); };

async function readNetwork(n: (typeof NETWORKS)[number]) {
  console.log(`\n\x1b[1m${n.name}\x1b[0m  jackpot=${n.addrs.jackpot}`);
  const client = createPublicClient({ chain: n.chain, transport: http(n.rpc) });

  try {
    const drawingId = (await client.readContract({
      address: n.addrs.jackpot, abi: JACKPOT_ABI, functionName: 'currentDrawingId',
    })) as bigint;
    ok(`currentDrawingId = ${drawingId}`);

    const s = (await client.readContract({
      address: n.addrs.jackpot, abi: JACKPOT_ABI, functionName: 'getDrawingState', args: [drawingId],
    })) as DrawingState;

    ok(`prizePool        = $${formatUsdc(s.prizePool)}`);
    ok(`ticketPrice      = $${formatUsdc(s.ticketPrice)}`);
    ok(`ballMax          = ${s.ballMax}   bonusballMax = ${s.bonusballMax}`);
    ok(`ticketsBought    = ${s.globalTicketsBought}`);
    ok(`jackpotLock      = ${s.jackpotLock}${s.jackpotLock ? '  <-- settling, queue purchases' : ''}`);

    const secs = Number(s.drawingTime) - Math.floor(Date.now() / 1000);
    const h = Math.floor(Math.abs(secs) / 3600), m = Math.floor((Math.abs(secs) % 3600) / 60);
    ok(`drawingTime      = ${new Date(Number(s.drawingTime) * 1000).toISOString()} (${secs < 0 ? 'passed' : `in ${h}h ${m}m`})`);

    // Referral economics — two streams, both 1e18-scaled.
    const pct = (v: bigint) => `${(Number(v) / 1e18 * 100).toFixed(2)}%`;
    ok(`referralFee      = ${pct(s.referralFee)}  referralWinShare = ${pct(s.referralWinShare)}`);

    return s;
  } catch (e) {
    bad(`read failed: ${(e as Error).message.split('\n')[0]}`);
    return null;
  }
}

/**
 * Fetch with a couple of retries.
 *
 * These are calls to somebody else's service over the public internet, and a
 * single transient failure was enough to turn this whole script red — which
 * trains you to ignore it. Retry, then report honestly.
 */
async function fetchRetry(url: string, attempts = 3): Promise<Response> {
  let last: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      last = e as Error;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last ?? new Error('fetch failed');
}

async function checkDataApi(base: string, label: string) {
  console.log(`\n\x1b[1mData API — ${label}\x1b[0m  ${base}`);
  try {
    const res = await fetchRetry(`${base}/rounds/active`);
    if (!res.ok) { bad(`/rounds/active -> ${res.status}`); return; }
    const r = await res.json();
    ok(`round ${r.id} · pool $${(Number(r.prize_pool.amount) / 10 ** r.prize_pool.decimals).toLocaleString()}`);
    ok(`tickets ${r.ticket_count} · participants ${r.unique_participants}`);
    ok(`ball_pool normals 1-${r.ball_pool.normals_max}, bonusball 1-${r.ball_pool.bonusball_max}`);
    ok(`closes ${r.ended_at}`);
  } catch (e) {
    bad(`fetch failed: ${(e as Error).message}`);
  }
}

/**
 * The contract we actually spend through.
 *
 * Numbers are the protocol's job, not ours, so every purchase goes through
 * JackpotRandomTicketBuyer. Confirm the deployment exists and that the ABI we
 * ship still matches the signature we call — a silent signature drift is the
 * failure mode that would only surface at payout time.
 */
async function checkRandomBuyer(n: (typeof NETWORKS)[number]) {
  console.log(`\n\x1b[1mJackpotRandomTicketBuyer — ${n.name}\x1b[0m  ${n.addrs.randomTicketBuyer}`);
  const client = createPublicClient({ chain: n.chain, transport: http(n.rpc) });

  try {
    const code = await client.getCode({ address: n.addrs.randomTicketBuyer });
    if (code && code !== '0x') ok(`contract deployed (${(code.length - 2) / 2} bytes)`);
    else bad('no contract code at that address');
  } catch (e) {
    bad(`code read failed: ${(e as Error).message.split('\n')[0]}`);
  }

  const fn = (RANDOM_TICKET_BUYER_ABI as readonly any[]).find(
    (e) => e.type === 'function' && e.name === 'buyTickets',
  );
  if (!fn) {
    bad('buyTickets missing from the shipped ABI');
    return;
  }
  const sig = `buyTickets(${fn.inputs.map((i: any) => i.type).join(',')})`;
  const expected = 'buyTickets(uint256,address,address[],uint256[],bytes32)';
  if (sig === expected) ok(`ABI signature matches what we call: ${sig}`);
  else bad(`signature drift — ABI has ${sig}, code calls ${expected}`);
}

/**
 * The race economy, derived from each network's LIVE ticket price.
 *
 * This is the check that would have caught hardcoding "$0.20": on Sepolia a
 * ticket costs $0.01, so a fixed 20-cent entry would be twenty times the price
 * of the thing it is supposed to be buying a fifth of.
 */
function checkEconomy(label: string, ticketPrice: bigint) {
  console.log(`\n\x1b[1mRace economy — ${label}\x1b[0m  (ticket ${formatPrecise(ticketPrice)})`);

  const fee = entryFeeUnits(ticketPrice);
  ok(`entry fee = ${formatPrecise(fee)} (a fifth of a ticket)`);

  if (fee * SHARDS_PER_TICKET === ticketPrice) {
    ok(`${SHARDS_PER_TICKET} shards fund exactly one ticket, no rounding loss`);
  } else {
    bad(`${SHARDS_PER_TICKET} × ${fee} = ${fee * SHARDS_PER_TICKET}, expected ${ticketPrice}`);
  }

  // The core claim of the design: a full lobby is exactly one ticket.
  const fullPot = fee * BigInt(SEATS_PER_RACE);
  if (fullPot === ticketPrice) {
    ok(`a full ${SEATS_PER_RACE}-seat pot (${formatPrecise(fullPot)}) is exactly one ticket`);
  } else {
    bad(`full pot ${fullPot} != ticket price ${ticketPrice}`);
  }

  // A player who wins 23 shards over time: whole tickets minted, remainder held.
  const vault = fee * 23n;
  const { tickets, spentUnits, remainderUnits } = vaultToTickets(vault, ticketPrice);
  if (spentUnits + remainderUnits === vault) {
    ok(`23 shards (${formatPrecise(vault)}) → ${tickets} tickets, ${formatPrecise(remainderUnits)} held`);
  } else {
    bad(`vault accounting lost value: ${spentUnits} + ${remainderUnits} != ${vault}`);
  }

  // Winner-take-all pots of every size must conserve value exactly.
  let held = 0n;
  let minted = 0;
  let staked = 0n;
  for (let seats = 1; seats <= SEATS_PER_RACE; seats++) {
    for (let round = 0; round < 4; round++) {
      const pot = fee * BigInt(seats);
      staked += pot;
      held += pot;
      const conv = vaultToTickets(held, ticketPrice);
      minted += conv.tickets;
      held -= conv.spentUnits;
    }
  }
  if (BigInt(minted) * ticketPrice + held === staked) {
    ok(`20 pots of mixed size conserve exactly: ${minted} tickets + ${formatPrecise(held)} held`);
  } else {
    bad(`pot conservation broken: ${minted} tickets + ${held} != ${staked}`);
  }
}

(async () => {
  console.log('\x1b[1m═══ Rally Vault · Megapot integration verification ═══\x1b[0m');

  const mainnet = await readNetwork(NETWORKS[0]);
  const testnet = await readNetwork(NETWORKS[1]);
  await checkRandomBuyer(NETWORKS[0]);
  await checkRandomBuyer(NETWORKS[1]);
  await checkDataApi('https://api.megapot.io/v1', 'mainnet');
  await checkDataApi('https://api-testnet.megapot.io/v1', 'testnet');

  if (mainnet) checkEconomy('Base Mainnet', mainnet.ticketPrice);
  if (testnet) checkEconomy('Base Sepolia', testnet.ticketPrice);

  console.log(
    failures === 0
      ? '\n\x1b[32m\x1b[1m✓ All checks passed.\x1b[0m\n'
      : `\n\x1b[31m\x1b[1m✗ ${failures} check(s) failed.\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
