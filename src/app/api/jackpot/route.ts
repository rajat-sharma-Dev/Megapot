import { NextResponse } from 'next/server';
import { getCurrentDrawing, formatUsdc } from '@/lib/megapot/drawing';
import { NETWORK, CONTRACTS, CHAIN_ID } from '@/lib/megapot/addresses';
import { getTreasuryAddress } from '@/lib/megapot/client';
import { getHouseFloat } from '@/lib/db/store';
import { entryFeeUnits, minDepositUnits, SEATS_PER_RACE, SHARDS_PER_TICKET } from '@/lib/vault/economy';
import { advanceLobbies } from '@/lib/vault/lobby';

export const dynamic = 'force-dynamic';

/**
 * Everything the client needs to open a session: live Megapot drawing state, the
 * economy derived from it, and where to send a deposit.
 *
 * One route rather than three because all of it is read from the same chain call
 * and a game client asking three questions before it can render a price is three
 * chances to show a loading spinner.
 */
export async function GET() {
  try {
    // Whoever loads the app is also the scheduler — see advanceLobbies.
    await advanceLobbies().catch(() => {});

    const d = await getCurrentDrawing();
    const fee = entryFeeUnits(d.ticketPrice);
    const treasury = getTreasuryAddress();

    return NextResponse.json({
      ok: true,
      network: NETWORK,
      chainId: CHAIN_ID,
      jackpotAddress: CONTRACTS.jackpot,
      usdcAddress: CONTRACTS.usdc,
      treasuryAddress: treasury,
      depositsEnabled: !!treasury,

      drawingId: d.drawingId.toString(),
      prizePool: d.prizePool.toString(),
      prizePoolFormatted: formatUsdc(d.prizePool),
      ticketPrice: d.ticketPrice.toString(),
      ticketPriceFormatted: formatUsdc(d.ticketPrice),
      ballMax: d.ballMax,
      bonusballMax: d.bonusballMax,
      ticketsBought: d.globalTicketsBought.toString(),
      drawingTimeMs: Number(d.drawingTime) * 1000,
      jackpotLock: d.jackpotLock,
      referralFeePct: Number(d.referralFee) / 1e16,
      referralWinSharePct: Number(d.referralWinShare) / 1e16,

      economy: {
        seatsPerRace: SEATS_PER_RACE,
        shardsPerTicket: Number(SHARDS_PER_TICKET),
        entryFeeUnits: fee.toString(),
        fullPotUnits: (fee * BigInt(SEATS_PER_RACE)).toString(),
        minDepositUnits: minDepositUnits(d.ticketPrice).toString(),
        houseFloatUnits: (await getHouseFloat()).toString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
