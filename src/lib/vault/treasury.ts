/**
 * Real money in and out — SERVER ONLY.
 *
 * A player's balance is not a number we invent. It is backed by USDC that
 * actually moved on Base, and this module is the only place that fact is
 * established:
 *
 *  · A deposit is credited by reading the receipt of a transaction the player
 *    sent themselves and finding a USDC `Transfer` in it whose sender is their
 *    wallet and whose recipient is the treasury. We never take the client's word
 *    for the amount, the sender, or that it happened at all.
 *  · A withdrawal is a real ERC-20 transfer signed by the treasury key.
 *
 * `MEGAPOT_DRY_RUN` governs TICKET PURCHASES only. Deposits and withdrawals are
 * always real, because the alternative — accepting a real deposit and simulating
 * the way back out — takes people's money.
 */

import 'server-only';
import { decodeEventLog, type Log } from 'viem';
import { publicClient, getTreasuryClient, getTreasuryAddress } from '../megapot/client';
import { CONTRACTS, CHAIN_ID } from '../megapot/addresses';
import { ERC20_ABI } from '../megapot/abi';

export { getTreasuryAddress };

/**
 * Confirmations required before a deposit is credited.
 *
 * One is enough on Base — it has single-block finality for practical purposes
 * and a reorg deep enough to matter would invalidate far more than this game.
 * Raise it if this is ever pointed at a chain where that is not true.
 */
const MIN_CONFIRMATIONS = 1n;

export class DepositError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DepositError';
  }
}

export type VerifiedDeposit = {
  txHash: `0x${string}`;
  fromAddress: `0x${string}`;
  units: bigint;
  blockNumber: bigint;
};

const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Verify that `txHash` really moved USDC from `expectedFrom` to the treasury,
 * and return how much.
 *
 * Sums every matching transfer in the receipt rather than taking the first, so a
 * batched or router-mediated deposit still credits the full amount. Transfers in
 * the same transaction that are not from this player to this treasury are
 * ignored, which is what stops someone pointing us at a stranger's transaction.
 */
export async function verifyDeposit(
  txHash: string,
  expectedFrom: string,
): Promise<VerifiedDeposit> {
  const treasury = getTreasuryAddress();
  if (!treasury) {
    throw new DepositError(
      'Deposits are not configured on this deployment — no treasury address is set.',
    );
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new DepositError('That is not a valid transaction hash.');
  }

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    throw new DepositError(
      'That transaction is not on chain yet. Wait for it to confirm and try again.',
    );
  }

  if (receipt.status !== 'success') {
    throw new DepositError('That transaction reverted on chain, so nothing was transferred.');
  }

  const head = await publicClient.getBlockNumber();
  if (head - receipt.blockNumber + 1n < MIN_CONFIRMATIONS) {
    throw new DepositError('That transaction needs another confirmation. Try again in a moment.');
  }

  const units = sumTransfersToTreasury(receipt.logs, expectedFrom, treasury);

  if (units <= 0n) {
    throw new DepositError(
      `No USDC transfer from ${expectedFrom} to the treasury was found in that transaction. ` +
        `Make sure you sent USDC (${CONTRACTS.usdc}) on chain ${CHAIN_ID}.`,
    );
  }

  return {
    txHash: txHash as `0x${string}`,
    fromAddress: expectedFrom.toLowerCase() as `0x${string}`,
    units,
    blockNumber: receipt.blockNumber,
  };
}

/**
 * Add up the USDC that this transaction moved from the player to the treasury.
 *
 * Only logs emitted by the USDC contract itself are considered — a token that
 * merely *claims* to be USDC by emitting an identical event from its own address
 * is the obvious way to fake a deposit, and checking the emitter is what closes
 * it. Anything that doesn't decode as a Transfer is skipped rather than throwing,
 * because a real deposit transaction routinely carries unrelated logs.
 */
function sumTransfersToTreasury(
  logs: readonly Log[],
  from: string,
  treasury: string,
): bigint {
  let total = 0n;

  for (const log of logs) {
    if (!sameAddress(log.address, CONTRACTS.usdc)) continue;

    try {
      const decoded = decodeEventLog({
        abi: ERC20_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'Transfer') continue;

      const args = decoded.args as unknown as { from: string; to: string; value: bigint };
      if (!sameAddress(args.from, from)) continue;
      if (!sameAddress(args.to, treasury)) continue;

      total += args.value;
    } catch {
      // Not an ERC-20 Transfer — normal, and not our business.
    }
  }

  return total;
}

/** How much USDC the treasury actually holds. Bounds every withdrawal. */
export async function treasuryBalance(): Promise<bigint> {
  const treasury = getTreasuryAddress();
  if (!treasury) return 0n;
  return (await publicClient.readContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [treasury],
  })) as bigint;
}

export class WithdrawalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalError';
  }
}

/**
 * Send USDC back to a player.
 *
 * Broadcast and waited on before the caller debits the balance, so a failed
 * transfer leaves the player's money exactly where it was. The reverse order —
 * debit first, send second — loses somebody's balance every time the RPC times
 * out, and it always eventually times out.
 */
export async function sendWithdrawal(
  to: `0x${string}`,
  units: bigint,
): Promise<`0x${string}`> {
  if (units <= 0n) throw new WithdrawalError('Withdrawal amount must be positive.');

  let treasuryClient;
  try {
    treasuryClient = getTreasuryClient();
  } catch {
    throw new WithdrawalError(
      'Withdrawals are unavailable: this deployment has no treasury signing key.',
    );
  }

  const balance = await treasuryBalance();
  if (balance < units) {
    throw new WithdrawalError(
      'The treasury is temporarily short of USDC for this withdrawal. Nothing was deducted — try again shortly.',
    );
  }

  const hash = await treasuryClient.wallet.writeContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, units],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new WithdrawalError('The withdrawal transaction reverted. Nothing was deducted.');
  }

  return hash;
}
