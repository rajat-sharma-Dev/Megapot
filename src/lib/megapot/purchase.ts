/**
 * Ticket purchase — SERVER ONLY.
 *
 * The treasury pays the USDC out of the day's pooled entry fees; `_recipient` is
 * the player, so the ticket NFT is minted straight into their wallet. This module
 * must never be imported from a client component.
 *
 * Numbers are chosen by the protocol, not by us. `JackpotRandomTicketBuyer` is
 * the contract Megapot provides for exactly this case, and using it means we
 * never have to reason about ball ranges drifting between a race and a purchase —
 * the protocol picks valid numbers at mint time, every time.
 */

import 'server-only';
import { publicClient, getTreasuryClient, getReferrer } from './client';
import { CONTRACTS } from './addresses';
import { RANDOM_TICKET_BUYER_ABI, ERC20_ABI } from './abi';
import { getCurrentDrawing, isSettling } from './drawing';

/** Referral splits are 1e18-scaled weights that must sum to EXACTLY 1e18. */
const PRECISE_UNIT = 1_000_000_000_000_000_000n;

/** Tag purchases so Megapot can attribute volume to Rally Vault. */
const SOURCE_TAG: `0x${string}` =
  '0x72616c6c792d7661756c74000000000000000000000000000000000000000000'; // "rally-vault"

/** `buyTickets` accepts 1–10 per call, so larger awards are split into batches. */
export const MAX_TICKETS_PER_TX = 10;

export type PurchaseResult = {
  txHash: `0x${string}`;
  drawingId: bigint;
  recipient: `0x${string}`;
  ticketPrice: bigint;
  count: number;
  /**
   * True when nothing was broadcast.
   *
   * Load bearing all the way to the UI. A simulated purchase has a synthetic
   * hash no explorer can find and mints no ticket, so anything that renders a
   * ticket has to be able to say so — showing a dead BaseScan link next to a
   * ticket that does not exist is the single most misleading thing this app
   * could do.
   */
  simulated: boolean;
  /**
   * The ticket ids the protocol assigned, when we can know them.
   *
   * `buyTickets` returns them, but a broadcast `writeContract` resolves to a
   * transaction hash rather than the call's return value — so they come from
   * simulating the same call immediately before sending it. Empty on a dry run,
   * because no ticket was ever created to have an id.
   */
  ticketIds: string[];
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
 * against live chain state — it just doesn't broadcast. That still catches a bad
 * referral split, a wrong address or an invalid ticket count, because those
 * revert in simulation exactly as they would on-chain. Only failures caused by
 * the treasury being unfunded are tolerated and waved through with a synthetic
 * hash.
 *
 * Defaults to ON. An unset variable must never mean "spend real money" — the
 * only way to broadcast is to say so explicitly.
 */
const DRY_RUN = process.env.MEGAPOT_DRY_RUN !== 'false';

/** Reverts that mean "your arguments are wrong" — never acceptable, even dry. */
const ARGUMENT_ERRORS = [
  'InvalidTicketCount', 'InvalidRecipient', 'InvalidReferralSplitBps',
  'ReferralSplitSumInvalid', 'ReferralSplitLengthMismatch',
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
 * Ensure `spender` can pull `total` USDC from the treasury.
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

  /**
   * Approve a batch's worth, not this purchase's worth.
   *
   * Approving exactly `total` meant the allowance hit zero after every single
   * purchase, so every ticket cost two transactions and two lots of gas for the
   * rest of time. Topping up to a run of purchases makes the approve amortise —
   * one approval, then many single-transaction buys.
   *
   * Deliberately NOT an infinite approval. This is a hot wallet on a server; a
   * bounded allowance means a compromise of the spender contract can take a
   * known, small amount rather than the treasury's entire balance. It is capped
   * by the balance too, so it can never approve more than exists.
   */
  const APPROVE_BATCH = 50n;
  const target = total * APPROVE_BATCH;
  const amount = target > balance ? balance : target;

  const hash = await wallet.writeContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, amount < total ? total : amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

/**
 * Buy `count` protocol-randomised tickets for `recipient`.
 *
 * One call, 1–10 tickets. Callers awarding more than ten should use
 * `buyTicketsFor`, which batches.
 */
export async function buyRandomTickets(
  recipient: `0x${string}`,
  count: number,
): Promise<PurchaseResult> {
  if (count < 1 || count > MAX_TICKETS_PER_TX) {
    throw new Error(`JackpotRandomTicketBuyer.buyTickets accepts 1-${MAX_TICKETS_PER_TX}, got ${count}`);
  }

  const drawing = await getCurrentDrawing();
  if (isSettling(drawing)) throw new SettlementInProgressError();

  const total = drawing.ticketPrice * BigInt(count);
  const [referrers, split] = referralArgs();
  const { account, wallet } = getTreasuryClient();

  const args = [BigInt(count), recipient, referrers, split, SOURCE_TAG] as unknown[];

  let txHash: `0x${string}`;
  let ticketIds: string[] = [];

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
    // The random buyer pulls USDC itself, so it is the spender here.
    await ensureAllowance(CONTRACTS.randomTicketBuyer, total);

    const call = {
      account,
      address: CONTRACTS.randomTicketBuyer,
      abi: RANDOM_TICKET_BUYER_ABI,
      functionName: 'buyTickets' as const,
      args,
    };

    /**
     * Simulate first, purely to capture the return value.
     *
     * `buyTickets` returns the ticket ids it minted, but `writeContract`
     * resolves to a transaction hash — the return value is unreachable from a
     * broadcast. Simulating the identical call against the same block gives us
     * the ids to store, and doubles as a last check that the arguments are
     * valid before spending anything.
     *
     * If the simulation fails we still broadcast: the ids are a nicety, and
     * refusing to buy a ticket somebody won because we couldn't pre-read its
     * number would be the wrong trade.
     */
    try {
      const { result } = await publicClient.simulateContract(call);
      if (Array.isArray(result)) ticketIds = (result as bigint[]).map((id) => id.toString());
    } catch {
      // Non-fatal — see above.
    }

    txHash = await wallet.writeContract(call);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  return {
    txHash,
    drawingId: drawing.drawingId,
    recipient,
    ticketPrice: drawing.ticketPrice,
    count,
    simulated: DRY_RUN,
    ticketIds,
  };
}

/**
 * Buy any number of tickets for one recipient, batching to the contract's
 * per-call limit. Returns one result per transaction.
 */
export async function buyTicketsFor(
  recipient: `0x${string}`,
  count: number,
): Promise<PurchaseResult[]> {
  const results: PurchaseResult[] = [];
  let left = count;
  while (left > 0) {
    const batch = Math.min(MAX_TICKETS_PER_TX, left);
    results.push(await buyRandomTickets(recipient, batch));
    left -= batch;
  }
  return results;
}
