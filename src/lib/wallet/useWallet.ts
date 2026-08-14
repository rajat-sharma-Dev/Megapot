'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useAccount, useChainId, useConnect, useDisconnect, useSwitchChain, useBalance,
  useReadContract,
} from 'wagmi';
import { TARGET_CHAIN, TARGET_CHAIN_ID, CHAIN_LABEL } from './config';
import { CONTRACTS } from '../megapot/addresses';
import { ERC20_MINIMAL_ABI } from './erc20';

/**
 * Wallet identity.
 *
 * The connected address is the player's identity, their deposit source, and the
 * destination every Megapot ticket is minted to. There is no server-side account
 * and no password — if you can sign with the address, it's yours.
 *
 * The racer name is the one piece of profile that isn't on chain, so it lives in
 * localStorage keyed by address. Switching wallets switches names, which is what
 * anyone sharing a browser would expect.
 */

const NAME_KEY = (address: string) => `rally_name_${address.toLowerCase()}`;

export const shortAddress = (a?: string | null) =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';

const defaultName = (address: string) => `Racer ${address.slice(2, 6).toUpperCase()}`;

export function useWallet() {
  const {
    address, isConnected, isConnecting, isReconnecting, connector,
    chainId: walletChainId,
  } = useAccount();
  const configChainId = useChainId();
  const { connect, connectors, isPending: connectPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, switchChainAsync, isPending: switchPending } = useSwitchChain();

  const [name, setNameState] = useState('');
  /** Guards every read of localStorage so the server render and the first client
   * render agree; without it the name flashes in and React complains. */
  const [hydrated, setHydrated] = useState(false);
  /**
   * True once we're willing to say "no wallet is connected".
   *
   * A restore attempt is worth waiting a moment for, so a returning player
   * doesn't see the connect screen flash before their session comes back. But
   * only a moment: gating the UI on a reconnect flag that never resolves is
   * exactly how the connect button ended up hidden behind a permanent skeleton
   * and `/play` span forever. The timeout makes that failure mode impossible
   * regardless of what the wallet layer does.
   */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const t = setTimeout(() => setSettled(true), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isReconnecting) setSettled(true);
  }, [isReconnecting]);

  useEffect(() => {
    if (!address) {
      setNameState('');
      return;
    }
    try {
      setNameState(localStorage.getItem(NAME_KEY(address)) || defaultName(address));
    } catch {
      setNameState(defaultName(address));
    }
  }, [address]);

  const setName = useCallback(
    (next: string) => {
      const trimmed = next.trim().slice(0, 20) || 'Racer';
      setNameState(trimmed);
      if (!address) return;
      try {
        localStorage.setItem(NAME_KEY(address), trimmed);
      } catch {
        // A browser with storage disabled just gets a per-session name.
      }
    },
    [address],
  );

  /**
   * The player's own USDC, on the target chain — what they can deposit from.
   *
   * Read through `useReadContract` rather than `useBalance`: wagmi v3 dropped
   * the `token` option, so a token balance is now an ordinary `balanceOf` call.
   */
  const { data: usdc, refetch: refetchUsdc } = useReadContract({
    address: CONTRACTS.usdc,
    abi: ERC20_MINIMAL_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });

  /** Native ETH, because a deposit needs gas and "why did nothing happen" is
   * almost always an empty gas tank. */
  const { data: gas } = useBalance({
    address,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  /**
   * The chain the wallet is ACTUALLY on.
   *
   * This must come from `useAccount()`, not from `useChainId()`. `useChainId()`
   * reports the config's current chain, which is clamped to the chains the
   * config declares — so a wallet sitting on a chain we never registered reads
   * back as one we did, the wrong-network guard never fires, and the first
   * transaction dies with a `ChainMismatchError` the UI had no idea was coming.
   * That is exactly what happened with a wallet left on chain 26217.
   *
   * `useChainId()` is still the right fallback for the disconnected case, where
   * there is no wallet chain to report.
   */
  const chainId = walletChainId ?? configChainId;
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN_ID;

  const switchToTarget = useCallback(() => {
    switchChain({ chainId: TARGET_CHAIN_ID });
  }, [switchChain]);

  /**
   * Move to the target chain and wait for it.
   *
   * Callers that are about to send a transaction use this rather than firing a
   * write and hoping: a switch is a wallet prompt the user can take seconds to
   * answer, and awaiting it is the difference between "approve, then it works"
   * and a chain-mismatch error.
   */
  const ensureTargetChain = useCallback(async () => {
    if (!isConnected) throw new Error('Connect a wallet first.');
    if ((walletChainId ?? configChainId) === TARGET_CHAIN_ID) return;
    await switchChainAsync({ chainId: TARGET_CHAIN_ID });
  }, [isConnected, walletChainId, configChainId, switchChainAsync]);

  const connectors_ = useMemo(
    () =>
      connectors.map((c) => ({
        uid: c.uid,
        id: c.id,
        name: c.name,
        icon: c.icon,
        connect: () => connect({ connector: c }),
      })),
    [connectors, connect],
  );

  return {
    address: (address ?? null) as `0x${string}` | null,
    isConnected,
    /** True while wagmi is restoring a previous session — not a fresh connect. */
    isReconnecting,
    connecting: isConnecting || connectPending,
    connectError: connectError?.message ?? null,
    connectorName: connector?.name ?? null,
    connectors: connectors_,
    disconnect,

    chainId,
    wrongNetwork,
    switchToTarget,
    ensureTargetChain,
    switching: switchPending,
    targetChain: TARGET_CHAIN,
    chainLabel: CHAIN_LABEL,

    usdcBalance: (usdc as bigint | undefined) ?? null,
    gasBalance: gas?.value ?? null,
    refetchUsdc,

    name,
    setName,
    /**
     * True once an effect has run, i.e. once client-only state can be trusted.
     *
     * Deliberately NOT folded together with `settled`. Anything whose markup
     * differs between connected and disconnected must gate on this, because it
     * is false during SSR *and* during the first client render — which is the
     * only way both sides produce the same tree. wagmi restores sessions from
     * localStorage, so without this the server renders a connect button while
     * the client renders an account chip, and React throws a hydration error.
     */
    ready: hydrated,
    /**
     * True once we know whether a previous session came back — either because
     * the reconnect finished, or because it took too long to keep waiting.
     * Use this for "still working it out" spinners, never for markup that has to
     * match the server.
     */
    settled,
  };
}

export type WalletApi = ReturnType<typeof useWallet>;
