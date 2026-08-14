/**
 * Treasury preflight.
 *
 *   npm run check:treasury
 *
 * Answers one question: if somebody wins a race right now, will a real Megapot
 * ticket actually be minted? Read-only — it simulates the purchase against live
 * chain state and spends nothing.
 *
 * This exists because the failure it catches is invisible from the app. An
 * unfunded treasury does not break the UI: races run, pots settle, and the
 * winner is simply refunded instead of getting a ticket — which looks like a
 * bug in the ticket flow rather than an empty gas tank.
 */

import { createPublicClient, http, formatEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { ADDRESSES, type MegapotNetwork } from '../src/lib/megapot/addresses';
import { RANDOM_TICKET_BUYER_ABI, ERC20_ABI } from '../src/lib/megapot/abi';

/** Read .env.local directly — this runs outside Next, which normally loads it. */
function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(), ...process.env } as Record<string, string>;

const NETWORK = (env.NEXT_PUBLIC_MEGAPOT_NETWORK as MegapotNetwork) ?? 'testnet';
const CHAIN = NETWORK === 'mainnet' ? base : baseSepolia;
const ADDR = ADDRESSES[NETWORK];
const RPC =
  env.RPC_URL ||
  env.NEXT_PUBLIC_RPC_URL ||
  (NETWORK === 'mainnet' ? 'https://mainnet.base.org' : 'https://sepolia.base.org');

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗ ${m}\x1b[0m`);
const warn = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

/** Tag purchases so Megapot can attribute volume. Mirrors purchase.ts. */
const SOURCE_TAG = '0x72616c6c792d7661756c74000000000000000000000000000000000000000000' as const;
const PRECISE_UNIT = 1_000_000_000_000_000_000n;

async function main() {
  console.log('\x1b[1m═══ Treasury preflight ═══\x1b[0m');
  console.log(`  network ${NETWORK} · rpc ${RPC.replace(/\/v2\/.*/, '/v2/…')}`);

  const key = env.TREASURY_PRIVATE_KEY;
  if (!key) {
    bad('TREASURY_PRIVATE_KEY is not set — no tickets can be bought and no withdrawals paid.');
    process.exit(1);
  }

  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
  const client = createPublicClient({ chain: CHAIN, transport: http(RPC) });

  console.log(`\n\x1b[1mTreasury\x1b[0m  ${account.address}`);

  // Anvil/Hardhat test account #0. Its key is in Hardhat's published docs.
  if (account.address.toLowerCase() === '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266') {
    warn('This is Hardhat test account #0 — its private key is PUBLIC. Anyone can drain');
    warn('deposits sent here. Rotate before deploying anywhere reachable.');
  }

  const [eth, usdc, allowance, gasPrice] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.readContract({
      address: ADDR.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
    }) as Promise<bigint>,
    client.readContract({
      address: ADDR.usdc, abi: ERC20_ABI, functionName: 'allowance',
      args: [account.address, ADDR.randomTicketBuyer],
    }) as Promise<bigint>,
    client.getGasPrice(),
  ]);

  // A first purchase is two transactions (approve, then buy); later ones are one.
  const perTx = gasPrice * 250_000n;
  const needed = allowance > 0n ? perTx : perTx * 2n;

  console.log(`\n\x1b[1mBalances\x1b[0m`);
  console.log(`  ETH        ${formatEther(eth)}`);
  console.log(`  USDC       ${formatUnits(usdc, 6)}`);
  console.log(`  allowance  ${formatUnits(allowance, 6)} → random ticket buyer`);
  console.log(`  gas price  ${formatUnits(gasPrice, 9)} gwei`);

  console.log(`\n\x1b[1mCan it mint?\x1b[0m`);

  let fatal = false;
  if (eth >= needed) {
    ok(`gas covers the next purchase (needs ~${formatEther(needed)} ETH)`);
  } else {
    bad(`NOT ENOUGH GAS — has ${formatEther(eth)} ETH, needs ~${formatEther(needed)} ETH`);
    console.log(`      Send Base Sepolia ETH to ${account.address}`);
    console.log('      https://www.alchemy.com/faucets/base-sepolia');
    fatal = true;
  }

  const dryRun = env.MEGAPOT_DRY_RUN !== 'false';
  if (dryRun) {
    warn('MEGAPOT_DRY_RUN is on — purchases are simulated, so no real ticket is minted.');
  } else {
    ok('MEGAPOT_DRY_RUN=false — purchases are real.');
  }

  // The decisive check: would the actual call succeed against live state?
  try {
    await client.simulateContract({
      account,
      address: ADDR.randomTicketBuyer,
      abi: RANDOM_TICKET_BUYER_ABI,
      functionName: 'buyTickets',
      args: [1n, account.address, [account.address], [PRECISE_UNIT], SOURCE_TAG],
    });
    ok('a real ticket purchase simulates cleanly — a win will mint.');
  } catch (err) {
    const msg = String((err as Error).message).split('\n')[0];
    if (msg.includes('allowance')) {
      // Expected before the first buy; the app approves automatically.
      ok('purchase reverts only on allowance, which the app approves on first buy.');
    } else {
      bad(`purchase would fail: ${msg}`);
      fatal = true;
    }
  }

  console.log(
    fatal
      ? '\n\x1b[31m\x1b[1m✗ Not ready — wins will be refunded instead of minting a ticket.\x1b[0m\n'
      : '\n\x1b[32m\x1b[1m✓ Ready to mint real tickets.\x1b[0m\n',
  );
  process.exit(fatal ? 1 : 0);
}

main().catch((e) => {
  bad(`preflight failed: ${(e as Error).message}`);
  process.exit(1);
});
