/**
 * Day-1 proof: the Megapot layer talks to the real protocol correctly.
 *
 *   npx tsx scripts/verify-megapot.ts
 *
 * Reads live drawing state from BOTH Base mainnet and Base Sepolia, checks the
 * Data API, and exercises the Shard -> ticket builder against the real ball
 * ranges. No transactions, no spending — read-only.
 */

import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { ADDRESSES } from '../src/lib/megapot/addresses';
import { JACKPOT_ABI } from '../src/lib/megapot/abi';
import { buildTicket, generateShardNumbers, generateOrbBonusball, makeRng } from '../src/lib/megapot/numbers';
import { formatUsdc, type DrawingState } from '../src/lib/megapot/drawing';

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

async function checkDataApi(base: string, label: string) {
  console.log(`\n\x1b[1mData API — ${label}\x1b[0m  ${base}`);
  try {
    const res = await fetch(`${base}/rounds/active`);
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

function checkTicketBuilder(ballMax: number, bonusballMax: number) {
  console.log(`\n\x1b[1mShard → Ticket builder\x1b[0m  (ballMax=${ballMax}, bonusballMax=${bonusballMax})`);
  const rng = makeRng(20260808);

  // 1. Perfect run — all five earned.
  const shards = generateShardNumbers(8, ballMax, rng);
  const orb = generateOrbBonusball(bonusballMax, rng);
  const perfect = buildTicket(shards, orb, ballMax, bonusballMax, rng);
  if (perfect.earnedNormals.length === 5 && perfect.bonusballEarned) {
    ok(`perfect run: shards [${shards.join(',')}] → normals [${perfect.normals.join(',')}] ✦${perfect.bonusball} (all earned)`);
  } else bad(`perfect run should earn 5 normals + bonusball, got ${perfect.earnedNormals.length} + ${perfect.bonusballEarned}`);

  // 2. Partial run — two collected, three filled, no orb.
  //    Take two DISTINCT shard values; the generator may repeat a value across shards.
  const distinctShards = [...new Set(shards)].slice(0, 2);
  const partial = buildTicket(distinctShards, null, ballMax, bonusballMax, rng);
  if (partial.earnedNormals.length === 2 && partial.filledNormals.length === 3 && !partial.bonusballEarned) {
    ok(`partial run: 2 earned [${partial.earnedNormals}] + 3 filled [${partial.filledNormals}] → [${partial.normals.join(',')}] ✦${partial.bonusball}`);
  } else bad(`partial run mismatch: ${partial.earnedNormals.length} earned / ${partial.filledNormals.length} filled`);

  // 3. Score Trap — a duplicate must not consume a second slot.
  const dup = buildTicket([7, 7, 7, 12, 19, 23, 28], 3, ballMax, bonusballMax, rng);
  if (dup.earnedNormals.length === 5 && new Set(dup.normals).size === 5) {
    ok(`score trap: duplicates collapsed → [${dup.normals.join(',')}] (5 unique)`);
  } else bad(`duplicate handling failed: [${dup.normals}]`);

  // 4. Range shrink between race and purchase — out-of-range must be re-rolled.
  const shrunk = buildTicket([ballMax + 5, 1, 2, 3, 4, 5], bonusballMax + 3, ballMax, bonusballMax, rng);
  if (shrunk.rerolledOutOfRange.length === 2 && shrunk.normals.every((n) => n <= ballMax)) {
    ok(`range shrink: re-rolled [${shrunk.rerolledOutOfRange}] → valid [${shrunk.normals.join(',')}] ✦${shrunk.bonusball}`);
  } else bad(`out-of-range handling failed: rerolled=${shrunk.rerolledOutOfRange}`);

  // 5. Fuzz — every ticket must satisfy the protocol's rules.
  let fuzzFails = 0;
  for (let i = 0; i < 2000; i++) {
    const r = makeRng(i);
    const count = 1 + Math.floor(r() * 8);
    const picks = Array.from({ length: count }, () => 1 + Math.floor(r() * ballMax));
    const t = buildTicket(picks, r() > 0.6 ? generateOrbBonusball(bonusballMax, r) : null, ballMax, bonusballMax, r);
    const asc = t.normals.every((n, j) => j === 0 || n > t.normals[j - 1]);
    const inRange = t.normals.every((n) => n >= 1 && n <= ballMax);
    if (t.normals.length !== 5 || !asc || !inRange || t.bonusball < 1 || t.bonusball > bonusballMax) fuzzFails++;
  }
  if (fuzzFails === 0) ok('fuzz 2000 runs: all tickets unique, ascending, in range');
  else bad(`fuzz: ${fuzzFails}/2000 invalid tickets`);
}

(async () => {
  console.log('\x1b[1m═══ Rally Vault · Megapot integration verification ═══\x1b[0m');

  const mainnet = await readNetwork(NETWORKS[0]);
  await readNetwork(NETWORKS[1]);
  await checkDataApi('https://api.megapot.io/v1', 'mainnet');
  await checkDataApi('https://api-testnet.megapot.io/v1', 'testnet');

  checkTicketBuilder(mainnet?.ballMax ?? 30, mainnet?.bonusballMax ?? 10);

  console.log(
    failures === 0
      ? '\n\x1b[32m\x1b[1m✓ All checks passed.\x1b[0m\n'
      : `\n\x1b[31m\x1b[1m✗ ${failures} check(s) failed.\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
