import { publicClient } from './client';
import { CONTRACTS } from './addresses';
import { JACKPOT_ABI } from './abi';

/**
 * Shape of Jackpot.getDrawingState(uint256) — verified against the live ABI.
 *
 * returns (uint256 prizePool, uint256 ticketPrice, uint256 edgePerTicket,
 *          uint256 referralWinShare, uint256 referralFee, uint256 globalTicketsBought,
 *          uint256 lpEarnings, uint256 drawingTime, uint256 winningTicket,
 *          uint8 ballMax, uint8 bonusballMax, address payoutCalculator, bool jackpotLock)
 */
export type DrawingState = {
  prizePool: bigint;
  ticketPrice: bigint;
  edgePerTicket: bigint;
  referralWinShare: bigint;
  referralFee: bigint;
  globalTicketsBought: bigint;
  lpEarnings: bigint;
  drawingTime: bigint;
  winningTicket: bigint;
  ballMax: number;
  bonusballMax: number;
  payoutCalculator: `0x${string}`;
  jackpotLock: boolean;
};

export type CurrentDrawing = DrawingState & { drawingId: bigint };

/**
 * Read the live drawing state.
 *
 * ballMax / bonusballMax are PER-DRAWING and can change between drawings, so
 * every ticket we build must be validated against a fresh read. Never hardcode
 * them — as of 8 Aug 2026 they happen to be 30 and 10, but that is not a contract.
 */
/**
 * Short-lived cache for the drawing read.
 *
 * This is two sequential contract calls — the second needs the id from the
 * first — so it costs a full round trip each time, and it is on the critical
 * path of almost every request: the config route, the profile route and joining
 * a lobby all need the live ticket price. Uncached that was ~500ms of every page
 * load, several times over, which is what made balances and the deposit panel
 * appear so long after the page did.
 *
 * A few seconds is safe. Drawing state changes once per drawing (daily on
 * mainnet), and the only fast-moving field is `prizePool`, which is a headline
 * number rather than something we transact against. Anything that *spends*
 * money re-reads inside its own transaction anyway.
 *
 * Deliberately short enough that `jackpotLock` is never badly stale — mistaking
 * a settling protocol for an open one wastes a purchase.
 */
const CACHE_MS = Number(process.env.MEGAPOT_DRAWING_CACHE_MS ?? 6_000);

type CacheEntry = { at: number; value: CurrentDrawing };
const g = globalThis as unknown as {
  __megapotDrawing?: CacheEntry;
  __megapotDrawingInflight?: Promise<CurrentDrawing>;
};

async function readDrawing(): Promise<CurrentDrawing> {
  const drawingId = (await publicClient.readContract({
    address: CONTRACTS.jackpot,
    abi: JACKPOT_ABI,
    functionName: 'currentDrawingId',
  })) as bigint;

  const s = (await publicClient.readContract({
    address: CONTRACTS.jackpot,
    abi: JACKPOT_ABI,
    functionName: 'getDrawingState',
    args: [drawingId],
  })) as DrawingState;

  return { ...s, drawingId };
}

export async function getCurrentDrawing(): Promise<CurrentDrawing> {
  const hit = g.__megapotDrawing;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  // Share one in-flight read between concurrent callers. A page that fires
  // three requests at once should cost one round trip, not three.
  if (g.__megapotDrawingInflight) return g.__megapotDrawingInflight;

  const inflight = readDrawing()
    .then((value) => {
      g.__megapotDrawing = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      g.__megapotDrawingInflight = undefined;
    });

  g.__megapotDrawingInflight = inflight;
  return inflight;
}

/** Force the next read to hit the chain. Used after anything that spends. */
export function invalidateDrawingCache() {
  g.__megapotDrawing = undefined;
}

/**
 * Has this drawing been drawn?
 *
 * `winningTicket` is zero until the Pyth entropy callback fires and the numbers
 * are fixed, so a non-zero value is the definitive settled signal. `jackpotLock`
 * is NOT the same question — it is true only during the settlement window
 * itself, so a drawing that finished an hour ago has `jackpotLock === false`
 * exactly like one that hasn't started.
 */
export function isDrawn(state: Pick<DrawingState, 'winningTicket'>): boolean {
  return state.winningTicket !== 0n;
}

/**
 * The most recently settled drawing.
 *
 * The active drawing is by definition unsettled, so the last settled one is
 * always the id below it. Returns null before the very first drawing has closed.
 */
export async function lastSettledDrawingId(): Promise<bigint | null> {
  const current = (await publicClient.readContract({
    address: CONTRACTS.jackpot,
    abi: JACKPOT_ABI,
    functionName: 'currentDrawingId',
  })) as bigint;
  return current > 0n ? current - 1n : null;
}

/**
 * Referral fees accrued to an address, in USDC base units.
 *
 * This is the integration's own revenue: Megapot pays a share of ticket price on
 * every purchase that named this address as a referrer, and it sits on the
 * contract until `claimReferralFees()` is called.
 */
export async function referralFeesOwed(address: `0x${string}`): Promise<bigint> {
  return (await publicClient.readContract({
    address: CONTRACTS.jackpot,
    abi: JACKPOT_ABI,
    functionName: 'referralFees',
    args: [address],
  })) as bigint;
}

/** Seconds until the current drawing closes. Negative once the cutoff has passed. */
export function secondsUntilDraw(state: Pick<DrawingState, 'drawingTime'>): number {
  return Number(state.drawingTime) - Math.floor(Date.now() / 1000);
}

/**
 * True when the protocol is mid-settlement. Purchases must be QUEUED, not attempted:
 * a buy during a lock is a wasted transaction and — during a live demo — a visible failure.
 */
export function isSettling(state: Pick<DrawingState, 'jackpotLock'>): boolean {
  return state.jackpotLock;
}

/** USDC has 6 decimals across Base. Format for display without floating point drift. */
export function formatUsdc(amount: bigint, decimals = 6): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${wholeStr}.${fracStr}`;
}
