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
export async function getCurrentDrawing(): Promise<CurrentDrawing> {
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
