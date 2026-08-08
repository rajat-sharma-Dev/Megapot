'use client';

import { useCallback, useEffect, useState } from 'react';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

/**
 * Wallet identity.
 *
 * A brand-new player gets a wallet generated for them on first visit — no
 * seed phrase, no extension, no signup. That mirrors how Megapot's own account
 * system onboards non-crypto-native users, and it means a judge can open the
 * link and be racing in one click.
 *
 * The key is testnet-only and lives in localStorage. It never signs a ticket
 * purchase — the treasury does that server-side — so its only job is to be a
 * stable identity and a destination for the ticket NFTs.
 *
 * An injected wallet (MetaMask, Coinbase Wallet) can be connected instead.
 */

const KEY_STORAGE = 'rally_vault_burner_key_v1';
const NAME_STORAGE = 'rally_vault_name_v1';

export type WalletState = {
  address: `0x${string}` | null;
  name: string;
  isBurner: boolean;
  ready: boolean;
};

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    name: '',
    isBurner: true,
    ready: false,
  });

  // Restore or create on mount.
  useEffect(() => {
    try {
      let key = localStorage.getItem(KEY_STORAGE);
      if (!key) {
        key = generatePrivateKey();
        localStorage.setItem(KEY_STORAGE, key);
      }
      const account = privateKeyToAccount(key as `0x${string}`);
      const stored = localStorage.getItem(NAME_STORAGE);
      const name = stored || `Racer ${account.address.slice(2, 6).toUpperCase()}`;
      if (!stored) localStorage.setItem(NAME_STORAGE, name);

      setState({ address: account.address, name, isBurner: true, ready: true });
    } catch {
      setState((s) => ({ ...s, ready: true }));
    }
  }, []);

  const setName = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 20) || 'Racer';
    localStorage.setItem(NAME_STORAGE, trimmed);
    setState((s) => ({ ...s, name: trimmed }));
  }, []);

  /** Connect an injected wallet. Tickets then mint to that address instead. */
  const connectInjected = useCallback(async () => {
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!eth) throw new Error('No browser wallet detected. Install MetaMask or keep using your instant wallet.');
    const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts?.length) throw new Error('No account authorised');
    setState((s) => ({ ...s, address: accounts[0] as `0x${string}`, isBurner: false }));
  }, []);

  /** Drop back to the generated wallet. */
  const useBurner = useCallback(() => {
    const key = localStorage.getItem(KEY_STORAGE);
    if (!key) return;
    const account = privateKeyToAccount(key as `0x${string}`);
    setState((s) => ({ ...s, address: account.address, isBurner: true }));
  }, []);

  return { ...state, setName, connectInjected, useBurner };
}

export const shortAddress = (a?: string | null) =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
