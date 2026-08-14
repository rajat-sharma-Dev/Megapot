/**
 * Megapot Data API client — https://api.megapot.io/v1 (docs: /v1/docs).
 *
 * No API key required for the anonymous tier (120 req/min). A key raises it to
 * 300 req/min; set MEGAPOT_API_KEY server-side if we ever need it.
 *
 * All monetary values arrive as { amount: "<integer string>", decimals: n } in
 * the token's smallest unit. Never parse these as floats.
 */

import { DATA_API_BASE } from './addresses';

export type Amount = { amount: string; decimals: number };

export type BallPool = { normals_max: number; bonusball_max: number };

export type PrizeTier = {
  tier_id: number;
  normal_matches: number;
  bonusball_match: boolean;
  payout: Amount;
  ticket_count: number;
};

export type Round = {
  id: string;
  status: 'active' | 'settled' | string;
  prize_pool: Amount;
  ticket_count: number;
  unique_participants: number;
  winners_count: number;
  top_prize_amount: Amount | null;
  started_at: string;
  ended_at: string;
  settled_at: string | null;
  ball_pool: BallPool;
  winning_numbers: { normals: number[]; bonusball: number } | null;
  prize_tiers: PrizeTier[];
};

export type WalletTicket = {
  ticket_id?: string;
  round_id?: string;
  normals?: number[];
  bonusball?: number;
  [k: string]: unknown;
};

/**
 * A winning ticket, as the Data API reports it.
 *
 * `user_ticket_id` is the value `Jackpot.claimWinnings(uint256[])` expects, and
 * `claimed` is what stops us offering a claim for money already taken. Shape
 * verified against the live OpenAPI schema rather than assumed.
 */
export type Win = {
  id: string;
  wallet: string;
  buyer: string;
  round_id: string;
  user_ticket_id: string;
  normals: number[];
  bonusball: number;
  matched_normals: number;
  bonusball_match: boolean;
  amount: Amount;
  claimed: boolean;
  claimed_tx_hash: string | null;
  tx_hash: string;
  block_number: number;
  created_at: string;
};

export type Paginated<T> = {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
};

export type WalletStats = {
  address: string;
  total_tickets: number;
  total_wins: number;
  total_winnings: Amount;
  total_spent: Amount;
  total_referral_earnings: Amount;
  rounds_played: number;
};

async function get<T>(path: string, revalidate = 30): Promise<T> {
  const key = process.env.MEGAPOT_API_KEY;
  const res = await fetch(`${DATA_API_BASE}${path}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    next: { revalidate },
  });
  if (!res.ok) {
    throw new Error(`Megapot Data API ${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Current drawing: prize pool, ball ranges, close time. Powers the Hub ticker. */
export const getActiveRound = () => get<Round>('/rounds/active', 15);

export const getLatestSettledRound = () => get<Round>('/rounds/latest-settled', 60);

/** A player's real tickets. Unknown wallets return zeroed data, not an error. */
export const getWalletTickets = (address: string, limit = 50) =>
  get<Paginated<WalletTicket>>(`/wallets/${address}/tickets?limit=${limit}`, 15);

/**
 * A wallet's winning tickets. Pass `claimed: false` for the ones still owed.
 *
 * Short revalidate on purpose: this drives a "claim your winnings" button, and
 * a stale cache there means offering someone a claim they already made.
 */
export const getWalletWins = (address: string, claimed?: boolean) =>
  get<Paginated<Win>>(
    `/wallets/${address}/wins${claimed === undefined ? '' : `?claimed=${claimed}`}`,
    10,
  );

export const getWalletStats = (address: string) =>
  get<WalletStats>(`/wallets/${address}/stats`, 30);

/** Convert an Amount to a display string without floating-point drift. */
export function formatAmount(a: Amount, maxFractionDigits = 2): string {
  const negative = a.amount.startsWith('-');
  const digits = negative ? a.amount.slice(1) : a.amount;
  const padded = digits.padStart(a.decimals + 1, '0');
  const whole = padded.slice(0, padded.length - a.decimals) || '0';
  const frac = a.decimals ? padded.slice(padded.length - a.decimals) : '';
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracFmt = frac.slice(0, maxFractionDigits);
  return `${negative ? '-' : ''}${wholeFmt}${fracFmt ? `.${fracFmt}` : ''}`;
}
