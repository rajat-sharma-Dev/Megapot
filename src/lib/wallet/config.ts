/**
 * Wallet configuration.
 *
 * Real wallets, real chain. There is no generated burner and no simulated
 * connect: a player signs in with MetaMask, Coinbase Wallet, Rabby or anything
 * else that speaks EIP-1193, and that address is where their Megapot tickets are
 * minted. It has to be an address they actually control, because a ticket minted
 * to a key the game invented is a ticket nobody can claim a prize with.
 *
 * Both Base and Base Sepolia are registered so the app can *detect* the wrong
 * network and offer to switch, rather than silently failing every transaction.
 */

import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
// Imported from their own subpaths rather than the `wagmi/connectors` barrel:
// the barrel also re-exports connectors whose SDKs are optional peer
// dependencies this project doesn't install, and the bundler fails on them.
import { injected } from 'wagmi/connectors/injected';
import { coinbaseWallet } from 'wagmi/connectors/coinbaseWallet';
import { NETWORK, CHAIN_ID } from '../megapot/addresses';

export const TARGET_CHAIN = NETWORK === 'mainnet' ? base : baseSepolia;
export const TARGET_CHAIN_ID = CHAIN_ID;

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  (NETWORK === 'mainnet' ? 'https://mainnet.base.org' : 'https://sepolia.base.org');

/**
 * Two connectors, deliberately.
 *
 * `injected` covers every browser extension wallet — MetaMask, Rabby, Brave,
 * Frame — and Coinbase Wallet covers mobile and Coinbase Smart Wallet, which is
 * the shortest path from "no wallet at all" to a funded address.
 *
 * WalletConnect is NOT wired up, and that is a decision rather than an
 * oversight: it needs both a project id and the `@walletconnect/ethereum-provider`
 * peer dependency, and merely importing the connector without that package makes
 * the bundler emit an unresolved-module warning on every build. To add it,
 * install the package and register `walletConnect({ projectId })` here.
 */
const CONNECTORS = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({
    appName: 'Rally Vault',
    // 'all' offers both the extension and Coinbase Smart Wallet.
    preference: { options: 'all' },
  }),
];

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: CONNECTORS,
  transports: {
    [base.id]: http(NETWORK === 'mainnet' ? RPC_URL : 'https://mainnet.base.org'),
    [baseSepolia.id]: http(NETWORK === 'mainnet' ? 'https://sepolia.base.org' : RPC_URL),
  },
  /**
   * `ssr` is deliberately OFF.
   *
   * It looks like the right switch for a Next app and it is not, unless you also
   * pass `initialState` to `WagmiProvider` (via `cookieStorage` +
   * `cookieToInitialState`). `ssr: true` tells wagmi to defer hydration and wait
   * for connection state the server is supposed to supply — and when that state
   * never arrives, the account status can sit in `reconnecting` indefinitely.
   *
   * That is not theoretical: it froze the connect button behind a permanent
   * loading skeleton and left `/play` spinning forever, because both gated on a
   * `ready` flag derived from `isReconnecting`. With `ssr` off, wagmi reads
   * localStorage on mount and resolves immediately.
   *
   * If server-rendered connection state is ever wanted, turn this back on AND
   * wire `initialState` in the same change — never one without the other.
   */
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export const CHAIN_LABEL = NETWORK === 'mainnet' ? 'Base' : 'Base Sepolia';

/**
 * Where to get spendable USDC on the target network. Shown in the deposit panel
 * rather than buried in a README — a player staring at a zero balance needs the
 * next step on the same screen.
 */
export const FAUCET_URL =
  NETWORK === 'mainnet'
    ? 'https://www.coinbase.com/price/usdc'
    : 'https://faucet.circle.com/';
