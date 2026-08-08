/**
 * Shards -> Megapot ticket.
 *
 * This is the core of Rally Vault's integration: the numbers on the lottery
 * ticket are the numbers the player physically collected during the race.
 *
 * Protocol validation rules (from the live Jackpot ABI + task docs):
 *   - normals:   exactly 5, UNIQUE, ASCENDING, each in [1, ballMax]
 *   - bonusball: non-zero, in [1, bonusballMax]
 *
 * ballMax / bonusballMax are per-drawing state. A race generated shortly before
 * a drawing rollover can hold numbers that are out of range by the time we buy,
 * so every number is re-validated here against a FRESH drawing read and re-rolled
 * if it no longer fits. The result records exactly which numbers were earned and
 * which were filled, because the UI promises the player that distinction.
 */

export type TicketNumbers = {
  normals: number[]; // exactly 5, unique, ascending
  bonusball: number;
};

export type BuiltTicket = TicketNumbers & {
  /** Numbers that came from Shards the player actually collected, in pickup order. */
  earnedNormals: number[];
  /** Numbers we had to fill in because the player didn't collect 5 distinct Shards. */
  filledNormals: number[];
  /** True when the player claimed the Golden Orb and thus earned the bonusball. */
  bonusballEarned: boolean;
  /** Numbers dropped because the drawing's range shrank between race and purchase. */
  rerolledOutOfRange: number[];
};

/** Deterministic RNG so races and tests reproduce exactly from a seed. */
export function makeRng(seed: number): () => number {
  // mulberry32
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));

export const NORMALS_PER_TICKET = 5;

/**
 * Build a protocol-valid ticket from what the player collected.
 *
 * @param collected   Shard numbers in pickup order (may contain duplicates from Score Traps)
 * @param orbBonusball Bonusball from the Golden Orb, or null if unclaimed
 * @param ballMax     From getDrawingState(currentDrawingId).ballMax
 * @param bonusballMax From getDrawingState(currentDrawingId).bonusballMax
 * @param rng         Seeded RNG; defaults to Math.random
 */
export function buildTicket(
  collected: number[],
  orbBonusball: number | null,
  ballMax: number,
  bonusballMax: number,
  rng: () => number = Math.random,
): BuiltTicket {
  if (ballMax < NORMALS_PER_TICKET) {
    throw new Error(`ballMax ${ballMax} cannot yield ${NORMALS_PER_TICKET} unique normals`);
  }

  const rerolledOutOfRange: number[] = [];
  const earned: number[] = [];
  const seen = new Set<number>();

  // Walk pickup order. Duplicates (Score Traps) and out-of-range values are dropped;
  // first 5 distinct valid numbers win their slots.
  for (const n of collected) {
    if (earned.length >= NORMALS_PER_TICKET) break;
    if (!Number.isInteger(n)) continue;
    if (n < 1 || n > ballMax) {
      rerolledOutOfRange.push(n);
      continue;
    }
    if (seen.has(n)) continue; // duplicate — the Score Trap penalty
    seen.add(n);
    earned.push(n);
  }

  // Fill any unearned slots from the numbers still available.
  const filled: number[] = [];
  while (earned.length + filled.length < NORMALS_PER_TICKET) {
    const candidate = randInt(rng, 1, ballMax);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    filled.push(candidate);
  }

  const normals = [...earned, ...filled].sort((a, b) => a - b);

  // Bonusball: earned from the Orb if it's still in range, else rolled.
  let bonusball: number;
  let bonusballEarned = false;
  if (orbBonusball !== null && orbBonusball >= 1 && orbBonusball <= bonusballMax) {
    bonusball = orbBonusball;
    bonusballEarned = true;
  } else {
    if (orbBonusball !== null) rerolledOutOfRange.push(orbBonusball);
    bonusball = randInt(rng, 1, bonusballMax);
  }

  const ticket: BuiltTicket = {
    normals,
    bonusball,
    earnedNormals: earned,
    filledNormals: filled,
    bonusballEarned,
    rerolledOutOfRange,
  };

  assertValidTicket(ticket, ballMax, bonusballMax);
  return ticket;
}

/**
 * Enforce the protocol's rules before we spend gas. Every one of these maps to a
 * named revert (InvalidBonusball, etc.) — failing here is free, failing on-chain is not.
 */
export function assertValidTicket(
  t: TicketNumbers,
  ballMax: number,
  bonusballMax: number,
): void {
  const { normals, bonusball } = t;
  if (normals.length !== NORMALS_PER_TICKET) {
    throw new Error(`normals must have exactly ${NORMALS_PER_TICKET} entries, got ${normals.length}`);
  }
  if (new Set(normals).size !== normals.length) {
    throw new Error(`normals must be unique, got [${normals}]`);
  }
  for (let i = 1; i < normals.length; i++) {
    if (normals[i] <= normals[i - 1]) {
      throw new Error(`normals must be strictly ascending, got [${normals}]`);
    }
  }
  for (const n of normals) {
    if (!Number.isInteger(n) || n < 1 || n > ballMax) {
      throw new Error(`normal ${n} out of range [1, ${ballMax}]`);
    }
  }
  if (!Number.isInteger(bonusball) || bonusball < 1 || bonusball > bonusballMax) {
    throw new Error(`bonusball ${bonusball} out of range [1, ${bonusballMax}]`);
  }
}

/**
 * Generate the Shard numbers for a race track.
 *
 * Guarantees at least NORMALS_PER_TICKET distinct values are present, so a
 * perfect run always yields a fully-earned ticket. Remaining shards may repeat
 * a value — those double as natural Score Trap material.
 */
export function generateShardNumbers(
  shardCount: number,
  ballMax: number,
  rng: () => number,
): number[] {
  if (shardCount < NORMALS_PER_TICKET) {
    throw new Error(`shardCount ${shardCount} must be >= ${NORMALS_PER_TICKET}`);
  }
  const distinct = new Set<number>();
  while (distinct.size < NORMALS_PER_TICKET) distinct.add(randInt(rng, 1, ballMax));
  const numbers = [...distinct];
  while (numbers.length < shardCount) numbers.push(randInt(rng, 1, ballMax));

  // Fisher-Yates so the guaranteed-distinct values aren't always the first shards.
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

/** Bonusball carried by the Golden Orb for a given race. */
export function generateOrbBonusball(bonusballMax: number, rng: () => number): number {
  return randInt(rng, 1, bonusballMax);
}
