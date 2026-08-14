import { createPublicClient, createWalletClient, http, type Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { NETWORK } from './addresses';
import { envStr } from '../env';

export const CHAIN: Chain = NETWORK === 'mainnet' ? base : baseSepolia;

/**
 * RPC endpoint, server-private first.
 *
 * `RPC_URL` has no `NEXT_PUBLIC_` prefix, so it never reaches the browser and is
 * the one used for everything server-side — chain reads, deposit verification,
 * ticket purchases. `NEXT_PUBLIC_RPC_URL` is the fallback and is what the
 * browser gets for wagmi's own reads.
 *
 * The distinction matters because a provider key in a `NEXT_PUBLIC_` variable is
 * published to every visitor by definition. Keeping two lets the server use a
 * key that is never exposed, while the client uses one that is restricted by
 * domain in the provider's dashboard — or the public endpoint, which is rate
 * limited but leaks nothing.
 */
const RPC_URL =
  envStr(process.env.RPC_URL) ||
  envStr(process.env.NEXT_PUBLIC_RPC_URL) ||
  (NETWORK === 'mainnet' ? 'https://mainnet.base.org' : 'https://sepolia.base.org');

/** Read-only client. Safe in the browser. */
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

/**
 * Treasury wallet client — SERVER ONLY.
 *
 * This holds the key that pays for every ticket. It must never be imported
 * into a client component. Calling this from the browser will throw because
 * TREASURY_PRIVATE_KEY is not a NEXT_PUBLIC_ var and will be undefined there.
 */
export function getTreasuryClient() {
  const key = envStr(process.env.TREASURY_PRIVATE_KEY);
  if (!key) {
    throw new Error(
      'TREASURY_PRIVATE_KEY is not set. This function is server-only — it must ' +
        'never run in the browser.',
    );
  }
  const account = privateKeyToAccount(
    (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`,
  );
  return {
    account,
    wallet: createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) }),
  };
}

/**
 * The address players deposit to.
 *
 * Derived from the treasury key when there is one, so the deposit destination
 * and the wallet that pays for tickets can never drift apart. `TREASURY_ADDRESS`
 * exists for the read-only case: a deployment that wants to accept deposits and
 * show balances without holding a spending key on the server.
 *
 * Returns null when neither is configured, and every caller treats that as
 * "deposits are switched off" rather than guessing an address.
 */
export function getTreasuryAddress(): `0x${string}` | null {
  const key = envStr(process.env.TREASURY_PRIVATE_KEY);
  if (key) {
    return privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`)
      .address;
  }
  const explicit = envStr(process.env.TREASURY_ADDRESS);
  return explicit && /^0x[a-fA-F0-9]{40}$/.test(explicit)
    ? (explicit as `0x${string}`)
    : null;
}

/** Our own address, used as the referrer so the project earns protocol fees. */
export function getReferrer(): `0x${string}` | null {
  const r = process.env.NEXT_PUBLIC_REFERRER_ADDRESS;
  return r && /^0x[a-fA-F0-9]{40}$/.test(r) ? (r as `0x${string}`) : null;
}
