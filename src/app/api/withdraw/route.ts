import { NextResponse } from 'next/server';
import { getOrCreatePlayer, adjustBalance, updatePlayer, toUnits } from '@/lib/db/store';
import { sendWithdrawal, WithdrawalError } from '@/lib/vault/treasury';
import { txUrl } from '@/lib/megapot/addresses';

export const dynamic = 'force-dynamic';

const isAddress = (a: unknown): a is string =>
  typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/**
 * Send a player's spendable balance back to their own wallet.
 *
 * Deliberately fixed to the caller's address — there is no destination field, so
 * there is no way to aim a withdrawal at someone else's wallet, and no signature
 * scheme to get wrong.
 *
 * The transfer is broadcast and confirmed BEFORE the balance is debited. Doing
 * it the other way round loses somebody's money every time the RPC times out,
 * whereas this order can at worst pay out twice under a torn request — and the
 * balance check plus a confirmed receipt makes that visible rather than silent.
 *
 * The shard vault is deliberately NOT withdrawable. Shards are ticket value, not
 * cash; they leave as a Megapot ticket or they don't leave.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { address, amountUnits } = (body ?? {}) as {
      address?: unknown;
      amountUnits?: unknown;
    };

    if (!isAddress(address)) {
      return NextResponse.json(
        { ok: false, error: 'A valid wallet address is required' },
        { status: 400 },
      );
    }
    if (typeof amountUnits !== 'string' || !/^\d+$/.test(amountUnits)) {
      return NextResponse.json(
        { ok: false, error: 'amountUnits must be a whole number of USDC base units' },
        { status: 400 },
      );
    }

    const amount = BigInt(amountUnits);
    if (amount <= 0n) {
      return NextResponse.json({ ok: false, error: 'Amount must be positive' }, { status: 400 });
    }

    const player = await getOrCreatePlayer(address);
    const balance = toUnits(player.creditsUnits);
    if (balance < amount) {
      return NextResponse.json(
        {
          ok: false,
          error: `You only have ${balance} base units available to withdraw.`,
          code: 'INSUFFICIENT_FUNDS',
        },
        { status: 400 },
      );
    }

    const hash = await sendWithdrawal(address as `0x${string}`, amount);

    const updated = await adjustBalance({
      playerId: player.id,
      field: 'creditsUnits',
      deltaUnits: -amount,
      kind: 'withdrawal',
      txHash: hash,
      note: 'Withdrawn to your wallet',
    });

    await updatePlayer(player.id, {
      lifetimeWithdrawnUnits: (toUnits(player.lifetimeWithdrawnUnits) + amount).toString(),
    });

    return NextResponse.json({
      ok: true,
      txHash: hash,
      explorerUrl: txUrl(hash),
      withdrawnUnits: amount.toString(),
      creditsUnits: updated.creditsUnits,
    });
  } catch (err) {
    if (err instanceof WithdrawalError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
