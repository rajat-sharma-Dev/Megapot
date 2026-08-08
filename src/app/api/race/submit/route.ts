import { NextResponse } from 'next/server';
import { getRace, getPlayer } from '@/lib/db/store';
import { simulateRace, HUMAN_ID, type InputLog } from '@/lib/game/replay';
import { settleRaceForPlayer } from '@/lib/points/bank';
import { MAX_TICKS } from '@/lib/game/engine';

export const dynamic = 'force-dynamic';

/**
 * Submit a finished race.
 *
 * The client sends its input log, never a score. The server replays that log
 * against the stored seed, derives the outcome itself, and settles from that.
 * This is the boundary that stops a crafted request from minting free tickets.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { raceId, address, inputs } = body ?? {};

    if (typeof raceId !== 'string' || typeof address !== 'string') {
      return NextResponse.json({ ok: false, error: 'raceId and address are required' }, { status: 400 });
    }

    const log = inputs as InputLog | undefined;
    if (!log || !Array.isArray(log.lateral) || !Array.isArray(log.boostTicks)) {
      return NextResponse.json({ ok: false, error: 'inputs.lateral and inputs.boostTicks are required' }, { status: 400 });
    }
    if (log.lateral.length > MAX_TICKS) {
      return NextResponse.json({ ok: false, error: 'Input log exceeds the maximum race length' }, { status: 400 });
    }

    const race = await getRace(raceId);
    if (!race) {
      return NextResponse.json({ ok: false, error: 'Unknown race' }, { status: 404 });
    }
    if (race.playerId !== address.toLowerCase()) {
      return NextResponse.json({ ok: false, error: 'This race belongs to another player' }, { status: 403 });
    }
    if (race.settledAt) {
      return NextResponse.json({ ok: false, error: 'This race has already been settled' }, { status: 409 });
    }

    const player = await getPlayer(address);
    if (!player) {
      return NextResponse.json({ ok: false, error: 'Unknown player' }, { status: 404 });
    }

    // Replay — this is the authoritative outcome, not anything the client claimed.
    const { outcome } = simulateRace({
      seed: race.seed,
      raceId: race.id,
      humanName: player.name,
      ballMax: race.ballMax,
      bonusballMax: race.bonusballMax,
      inputs: {
        lateral: log.lateral.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)),
        boostTicks: log.boostTicks.filter((t) => typeof t === 'number' && Number.isFinite(t)),
      },
    });

    // The engine keys the human as HUMAN_ID; settlement keys by wallet address.
    const remapped = {
      ...outcome,
      racers: outcome.racers.map((r) =>
        r.id === HUMAN_ID ? { ...r, id: player.id } : r,
      ),
    };

    const result = await settleRaceForPlayer(race.id, player.id, remapped);

    return NextResponse.json({
      ok: true,
      ...result,
      outcome: remapped,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('already settled') ? 409 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
