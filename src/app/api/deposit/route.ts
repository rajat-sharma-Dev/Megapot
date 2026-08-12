import { NextResponse } from 'next/server';
import { getOrCreatePlayer, adjustBalance, ledgerHasTx, updatePlayer, toUnits } from '@/lib/db/store';
import { verifyDeposit, DepositError } from '@/lib/vault/treasury';
import { txUrl } from '@/lib/megapot/addresses';

export const dynamic = 'force-dynamic';

const isAddress = (a: unknown): a is string =>
  typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/**
 * Credit a deposit.
 *
 * The client sends a transaction hash, never an amount. The server reads that
 * transaction's receipt off Base, finds the USDC transfer from this wallet to
 * the treasury inside it, and credits exactly what actually moved. A request
 * claiming a hash that isn't theirs, didn't confirm, or moved a different token
 * gets nothing.
 *
 * Idempotent on the transaction hash, which is the whole ballgame: this is the
 * one endpoint where a replayed request would mint money.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { address, txHash } = (body ?? {}) as { address?: unknown; txHash?: unknown };

    if (!isAddress(address)) {
      return NextResponse.json(
        { ok: false, error: 'A valid wallet address is required' },
        { status: 400 },
      );
    }
    if (typeof txHash !== 'string') {
      return NextResponse.json({ ok: false, error: 'A transaction hash is required' }, { status: 400 });
    }

    // Checked before the chain read so a double-submit is cheap, and checked
    // again below under the same request so a race can't slip between them.
    if (await ledgerHasTx(txHash)) {
      const player = await getOrCreatePlayer(address);
      return NextResponse.json({
        ok: true,
        alreadyCredited: true,
        creditedUnits: '0',
        creditsUnits: player.creditsUnits,
        txHash,
        explorerUrl: txUrl(txHash),
      });
    }

    const verified = await verifyDeposit(txHash, address);

    if (await ledgerHasTx(txHash)) {
      const player = await getOrCreatePlayer(address);
      return NextResponse.json({
        ok: true,
        alreadyCredited: true,
        creditedUnits: '0',
        creditsUnits: player.creditsUnits,
        txHash,
        explorerUrl: txUrl(txHash),
      });
    }

    const player = await getOrCreatePlayer(address);
    const updated = await adjustBalance({
      playerId: player.id,
      field: 'creditsUnits',
      deltaUnits: verified.units,
      kind: 'deposit',
      txHash: verified.txHash,
      note: `Deposit confirmed in block ${verified.blockNumber}`,
    });

    await updatePlayer(player.id, {
      lifetimeDepositedUnits: (
        toUnits(player.lifetimeDepositedUnits) + verified.units
      ).toString(),
    });

    return NextResponse.json({
      ok: true,
      alreadyCredited: false,
      creditedUnits: verified.units.toString(),
      creditsUnits: updated.creditsUnits,
      txHash: verified.txHash,
      explorerUrl: txUrl(verified.txHash),
    });
  } catch (err) {
    if (err instanceof DepositError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
