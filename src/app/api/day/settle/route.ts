import { NextResponse } from 'next/server';
import { getDay, listDays } from '@/lib/db/store';
import { settleDay, settleDueDays } from '@/lib/vault/ladder';
import { vaultDayKey, isClosed } from '@/lib/vault/day';

export const dynamic = 'force-dynamic';

/** GET — what has settled and what is still owed. */
export async function GET() {
  const days = await listDays();
  return NextResponse.json({
    ok: true,
    today: vaultDayKey(),
    days: days.map((d) => ({
      key: d.key,
      closesAt: d.closesAt,
      entries: d.entries,
      poolUnits: d.poolUnits,
      settled: !!d.settlement,
      ticketsBought: d.settlement?.ticketsBought ?? null,
      carryOutUnits: d.settlement?.carryOutUnits ?? null,
    })),
  });
}

/**
 * POST — settle closed days.
 *
 * Normally this happens on its own: the first request after 17:00 UTC settles
 * yesterday. This endpoint exists so the payout can be driven explicitly, which
 * matters in two places — the end-to-end test, which cannot wait a day, and a
 * demo, where you want to show the whole cycle on command.
 *
 * `{ "key": "2026-08-12", "force": true }` settles one specific day even if it
 * hasn't closed yet. Without `force`, an open day is refused: settling early
 * would pay out a ladder people are still climbing.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { key, force } = (body ?? {}) as { key?: string; force?: boolean };

    if (typeof key === 'string') {
      const day = await getDay(key);
      if (!day) {
        return NextResponse.json({ ok: false, error: `Unknown vault day ${key}` }, { status: 404 });
      }
      if (!isClosed(key) && !force) {
        return NextResponse.json(
          {
            ok: false,
            error: `Vault day ${key} is still open (closes ${day.closesAt}). Pass force:true to settle it early.`,
          },
          { status: 409 },
        );
      }

      const result = await settleDay(key);
      return NextResponse.json({
        ok: true,
        settled: [
          {
            key,
            ticketsBought: result.ticketsBought,
            allocations: result.allocations,
            carryOutUnits: result.day.settlement?.carryOutUnits ?? '0',
          },
        ],
      });
    }

    const results = await settleDueDays();
    return NextResponse.json({
      ok: true,
      settled: results.map((r) => ({
        key: r.day.key,
        ticketsBought: r.ticketsBought,
        allocations: r.allocations,
        carryOutUnits: r.day.settlement?.carryOutUnits ?? '0',
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
