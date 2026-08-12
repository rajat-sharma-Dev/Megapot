import { NextResponse } from 'next/server';
import { submitRun } from '@/lib/vault/lobby';
import { toLobbyView } from '@/lib/vault/serialize';
import { MAX_TICKS } from '@/lib/game/engine';
import type { InputLog } from '@/lib/game/replay';

export const dynamic = 'force-dynamic';

/** Generous but finite: a 4-minute race at 60Hz can't need more holds than this. */
const MAX_BOOST_RUNS = 4000;

/**
 * Submit a finished (or abandoned) run.
 *
 * The client sends its input log and never a score. The server stores the log,
 * and when the last seat is in it replays the entire lobby and derives every
 * score itself. This is the boundary that stops a crafted request from taking a
 * pot: there is nothing in this request body that a score could be read from.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { lobbyId, address, inputs } = (body ?? {}) as {
      lobbyId?: unknown;
      address?: unknown;
      inputs?: unknown;
    };

    if (typeof lobbyId !== 'string' || typeof address !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'lobbyId and address are required' },
        { status: 400 },
      );
    }

    const log = inputs as InputLog | undefined;
    if (!log || !Array.isArray(log.lateral) || !Array.isArray(log.boostRuns)) {
      return NextResponse.json(
        { ok: false, error: 'inputs.lateral and inputs.boostRuns are required' },
        { status: 400 },
      );
    }
    if (log.lateral.length > MAX_TICKS) {
      return NextResponse.json(
        { ok: false, error: 'Input log exceeds the maximum race length' },
        { status: 400 },
      );
    }
    if (log.boostRuns.length > MAX_BOOST_RUNS) {
      return NextResponse.json(
        { ok: false, error: 'Too many boost runs in the input log' },
        { status: 400 },
      );
    }

    const clean: InputLog = {
      lateral: log.lateral.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)),
      boostRuns: log.boostRuns,
      quitTick:
        typeof log.quitTick === 'number' && Number.isFinite(log.quitTick) ? log.quitTick : null,
    };

    const result = await submitRun(lobbyId, address, clean);

    return NextResponse.json({
      ok: true,
      settled: result.settled,
      seatIndex: result.seatIndex,
      lobby: toLobbyView(result.lobby, address),
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('already been settled')
      ? 409
      : msg.includes('already submitted')
        ? 409
        : msg.includes('do not hold a seat')
          ? 403
          : msg.includes('Unknown lobby')
            ? 404
            : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
