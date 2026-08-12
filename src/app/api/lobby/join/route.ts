import { NextResponse } from 'next/server';
import { joinLobby, InsufficientFundsError } from '@/lib/vault/lobby';
import { toLobbyView } from '@/lib/vault/serialize';

export const dynamic = 'force-dynamic';

const isAddress = (a: unknown): a is string =>
  typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/**
 * Take a seat.
 *
 * Charges the entry fee, seats the player in the oldest lobby that still has
 * room, and opens a new one if there isn't one. The response deliberately does
 * NOT include the seed unless the lobby locked on this very join — see
 * `toLobbyView`.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { address, name } = (body ?? {}) as { address?: unknown; name?: unknown };

    if (!isAddress(address)) {
      return NextResponse.json(
        { ok: false, error: 'A valid wallet address is required' },
        { status: 400 },
      );
    }

    const trimmedName =
      typeof name === 'string' && name.trim() ? name.trim().slice(0, 20) : undefined;

    const result = await joinLobby(address, trimmedName);

    return NextResponse.json({
      ok: true,
      lobby: toLobbyView(result.lobby, address),
      seatIndex: result.seatIndex,
      entryFeeUnits: result.entryFeeUnits.toString(),
      creditsAfter: result.creditsAfter.toString(),
    });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          code: 'INSUFFICIENT_FUNDS',
          needUnits: err.needUnits.toString(),
          haveUnits: err.haveUnits.toString(),
        },
        { status: 402 },
      );
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
