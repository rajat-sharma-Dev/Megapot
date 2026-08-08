/**
 * Ticket purchase — SERVER ONLY.
 *
 * The treasury pays the USDC; `_recipient` is the player, so the ticket NFT is
 * minted straight into their wallet. This module must never be imported from a
 * client component.
 */

import 'server-only';
import { publicClient, getTreasuryClient, getReferrer } from './client';
import { CONTRACTS } from './addresses';
import { JACKPOT_ABI, RANDOM_TICKET_BUYER_ABI, ERC20_ABI } from './abi';
import { getCurrentDrawing, isSettling } from './drawing';
import { assertValidTicket, type TicketNumbers } from './numbers';

/** Referral splits are 1e18-scaled weights that must sum to EXACTLY 1e18. */
const PRECISE_UNIT = 1_000_000_000_000_000_000n;

/** Tag purchases so Megapot can attribute volume to Rally Vault. */
const SOURCE_TAG: `0x${string}` =
  '0x72616c6c792d7661756c74000000000000000000000000000000000000000000'; // "rally-vault"

export type PurchaseResult = {
  txHash: `0x${string}`;
  drawingId: bigint;
  recipient: `0x${string}`;
  ticketPrice: bigint;
  numbers: TicketNumbers[];
};

export class SettlementInProgressError extends Error {
  constructor() {
    super('Megapot is mid-settlement (jackpotLock). Queue this purchase and retry.');
    this.name = 'SettlementInProgressError';
  }
}

/**
 * Dry run.
 *
 * Builds the transaction for real, validates every argument, and SIMULATES it
 * against live Base Sepolia state — it just doesn't broadcast. That still
 * catches a malformed ticket, a bad referral split or a wrong address, because
 * those revert in simulation exactly as they would on-chain. Only failures
 * caused by the treasury being unfunded are tolerated and waved through with a
 * synthetic hash.
 *
 * Set MEGAPOT_DRY_RUN=false once the treasury holds testnet USDC.
 */
const DRY_RUN = process.env.MEGAPOT_DRY_RUN === 'true';

/** Reverts that mean "your arguments are wrong" — never acceptable, even dry. */
const ARGUMENT_ERRORS = [
  'InvalidBonusball', 'InvalidTicketCount', 'InvalidRecipient',
  'ReferralSplitSumInvalid', 'ReferralSplitLengthMismatch', 'InvalidReferralSplitBps',
  'AbiEncodingError', 'InvalidArrayError', 'AbiErrorSignatureNotFound',
];

/** Reverts that just mean "the treasury has no money yet". */
const FUNDING_ERRORS = [
  'transfer amount exceeds balance', 'insufficient allowance', 'ERC20',
  'SafeERC20FailedOperation', 'insufficient funds', 'exceeds the balance',
  'Treasury USDC balance too low',
];

export function isDryRun() {
  return DRY_RUN;
}

/**
 * Deterministic, obviously-fake hash so dry runs are never mistaken for real ones.
 * Must still be a well-formed 32-byte hash (0x + 64 hex) or downstream explorer
 * links and hash validation break.
 */
function syntheticHash(tag: string): `0x${string}` {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const word = h.toString(16).padStart(8, '0');
  // "dd1f" marker + enough repeats to guarantee at least 64 hex digits.
  const body = `dd1f${word.repeat(8)}`.slice(0, 64);
  return `0x${body}` as `0x${string}`;
}

async function simulateOnly(
  params: Parameters<typeof publicClient.simulateContract>[0],
  tag: string,
): Promise<`0x${string}`> {
  try {
    await publicClient.simulateContract(params);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (ARGUMENT_ERRORS.some((e) => msg.includes(e))) {
      throw new Error(`Dry run rejected the arguments — this would fail on-chain too: ${msg.split('\n')[0]}`);
    }
    if (!FUNDING_ERRORS.some((e) => msg.includes(e))) {
      throw new Error(`Dry run simulation failed unexpectedly: ${msg.split('\n')[0]}`);
    }
    // Unfunded treasury — expected before the faucet run.
  }
  return syntheticHash(tag);
}

/** Build the (referrers, split) pair. Empty arrays mean "no referral attribution". */
function referralArgs(): [readonly `0x${string}`[], readonly bigint[]] {
  const referrer = getReferrer();
  return referrer ? [[referrer], [PRECISE_UNIT]] : [[], []];
}

/**
 * Ensure the Jackpot contract can pull `total` USDC from the treasury.
 * Approves only when the existing allowance is short.
 */
async function ensureAllowance(spender: `0x${string}`, total: bigint) {
  const { account, wallet } = getTreasuryClient();

  const balance = (await publicClient.readContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint;

  if (balance < total) {
    throw new Error(
      `Treasury USDC balance too low: have ${balance}, need ${total} (6-decimal units). ` +
        `Fund ${account.address} on the target chain.`,
    );
  }

  const allowance = (await publicClient.readContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, spender],
  })) as bigint;

  if (allowance >= total) return;

  const hash = await wallet.writeContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, total],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

/**
 * Buy tickets with the player's EARNED numbers. This is the primary path —
 * the Point Bank threshold crossing.
 */
export async function buyEarnedTickets(
  recipient: `0x${string}`,
  tickets: TicketNumbers[],
): Promise<PurchaseResult> {
  if (tickets.length < 1 || tickets.length > 10) {
    throw new Error(`Jackpot.buyTickets accepts 1-10 tickets, got ${tickets.length}`);
  }

  const drawing = await getCurrentDrawing();
  if (isSettling(drawing)) throw new SettlementInProgressError();

  // Re-validate against the LIVE range, not the range the race was generated with.
  for (const t of tickets) {
    assertValidTicket(t, drawing.ballMax, drawing.bonusballMax);
  }

  const total = drawing.ticketPrice * BigInt(tickets.length);
  const [referrers, split] = referralArgs();
  const { account, wallet } = getTreasuryClient();

  const args = [
    tickets.map((t) => ({ normals: t.normals, bonusball: t.bonusball })),
    recipient,
    referrers,
    split,
    SOURCE_TAG,
  ] as unknown[];

  let txHash: `0x${string}`;

  if (DRY_RUN) {
    txHash = await simulateOnly(
      {
        account,
        address: CONTRACTS.jackpot,
        abi: JACKPOT_ABI,
        functionName: 'buyTickets',
        args,
      },
      `earned:${recipient}:${drawing.drawingId}:${tickets.map((t) => t.normals.join('-')).join('|')}`,
    );
  } else {
    await ensureAllowance(CONTRACTS.jackpot, total);
    txHash = await wallet.writeContract({
      address: CONTRACTS.jackpot,
      abi: JACKPOT_ABI,
      functionName: 'buyTickets',
      args,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  return {
    txHash,
    drawingId: drawing.drawingId,
    recipient,
    ticketPrice: drawing.ticketPrice,
    numbers: tickets,
  };
}

/**
 * Buy protocol-randomised tickets. Used for the Cookie path, which rewards
 * showing up rather than skill — so its numbers are not earned.
 */
export async function buyRandomTickets(
  recipient: `0x${string}`,
  count: number,
): Promise<Omit<PurchaseResult, 'numbers'>> {
  if (count < 1 || count > 10) {
    throw new Error(`JackpotRandomTicketBuyer.buyTickets accepts 1-10, got ${count}`);
  }

  const drawing = await getCurrentDrawing();
  if (isSettling(drawing)) throw new SettlementInProgressError();

  const total = drawing.ticketPrice * BigInt(count);
  const [referrers, split] = referralArgs();
  const { account, wallet } = getTreasuryClient();

  const args = [BigInt(count), recipient, referrers, split, SOURCE_TAG] as unknown[];

  let txHash: `0x${string}`;

  if (DRY_RUN) {
    txHash = await simulateOnly(
      {
        account,
        address: CONTRACTS.randomTicketBuyer,
        abi: RANDOM_TICKET_BUYER_ABI,
        functionName: 'buyTickets',
        args,
      },
      `random:${recipient}:${drawing.drawingId}:${count}`,
    );
  } else {
    // The random buyer pulls USDC itself, so it is the spender here — not the Jackpot.
    await ensureAllowance(CONTRACTS.randomTicketBuyer, total);
    txHash = await wallet.writeContract({
      address: CONTRACTS.randomTicketBuyer,
      abi: RANDOM_TICKET_BUYER_ABI,
      functionName: 'buyTickets',
      args,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  return {
    txHash,
    drawingId: drawing.drawingId,
    recipient,
    ticketPrice: drawing.ticketPrice,
  };
}
