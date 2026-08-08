/**
 * The number strip — the cheapest, highest-leverage UI in the build.
 *
 * It shows the Megapot ticket assembling itself while you race, so the
 * integration is visible during gameplay rather than only at payout.
 * Earned numbers read solid; unfilled slots read as empty sockets.
 */

export type TicketStripProps = {
  /** Numbers collected so far, in pickup order. */
  earned: number[];
  /** Bonusball from the Golden Orb, null until claimed. */
  bonusball: number | null;
  /** Slots the game will fill randomly at purchase time. */
  filled?: number[];
  size?: 'sm' | 'lg';
};

const NORMALS = 5;

export function TicketStrip({ earned, bonusball, filled = [], size = 'lg' }: TicketStripProps) {
  const box =
    size === 'lg'
      ? 'h-12 w-12 text-lg rounded-xl'
      : 'h-8 w-8 text-sm rounded-lg';

  const slots: Array<{ value: number | null; kind: 'earned' | 'filled' | 'empty' }> = [];
  for (const n of earned.slice(0, NORMALS)) slots.push({ value: n, kind: 'earned' });
  for (const n of filled) {
    if (slots.length < NORMALS) slots.push({ value: n, kind: 'filled' });
  }
  while (slots.length < NORMALS) slots.push({ value: null, kind: 'empty' });

  return (
    <div className="flex items-center gap-2">
      {slots.map((slot, i) => (
        <div
          key={i}
          className={[
            box,
            'flex items-center justify-center font-bold tabular-nums border-2 transition-colors',
            slot.kind === 'earned'
              ? 'bg-emerald-400 text-emerald-950 border-emerald-300'
              : slot.kind === 'filled'
                ? 'bg-slate-700 text-slate-300 border-slate-600 border-dashed'
                : 'bg-slate-900/60 text-slate-700 border-slate-700 border-dashed',
          ].join(' ')}
          title={
            slot.kind === 'earned'
              ? 'Earned from a Shard'
              : slot.kind === 'filled'
                ? 'Auto-filled — you did not collect this one'
                : 'Not yet collected'
          }
        >
          {slot.value ?? '—'}
        </div>
      ))}

      <div className="mx-1 text-slate-600">·</div>

      <div
        className={[
          box,
          'flex items-center justify-center font-bold tabular-nums border-2',
          bonusball !== null
            ? 'bg-amber-400 text-amber-950 border-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.5)]'
            : 'bg-slate-900/60 text-slate-700 border-slate-700 border-dashed',
        ].join(' ')}
        title={bonusball !== null ? 'Bonusball — claimed from the Golden Orb' : 'Bonusball — claim the Golden Orb'}
      >
        {bonusball ?? '✦'}
      </div>
    </div>
  );
}
