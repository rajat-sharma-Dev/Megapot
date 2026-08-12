'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/wallet/useWallet';
import { useSound } from '@/lib/audio/SoundProvider';
import { shortAddress } from '@/lib/wallet/useWallet';

/**
 * Connect / account control.
 *
 * Three states, in the order a player meets them: not connected, connected to
 * the wrong chain, connected and ready. The wrong-chain state is a first-class
 * screen rather than an error toast, because every single action in this app
 * fails from it and "switch network" is the only useful thing to say.
 */
export function ConnectButton({ compact }: { compact?: boolean }) {
  const w = useWallet();
  const { play } = useSound();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (!w.ready) {
    return <div className="h-10 w-36 animate-pulse rounded-xl bg-white/[0.05]" />;
  }

  if (w.isConnected && w.wrongNetwork) {
    return (
      <button
        onClick={() => {
          play('click');
          w.switchToTarget();
        }}
        disabled={w.switching}
        className="btn btn-danger px-4 py-2 text-sm"
      >
        {w.switching ? 'Switching…' : `Switch to ${w.chainLabel}`}
      </button>
    );
  }

  if (w.isConnected && w.address) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => {
            play('click');
            setOpen((o) => !o);
          }}
          className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 transition-colors hover:bg-white/[0.08]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
          <div className="text-left leading-tight">
            {!compact && (
              <div className="display text-xs font-semibold text-slate-200">{w.name}</div>
            )}
            <div className="num text-[11px] text-slate-500">{shortAddress(w.address)}</div>
          </div>
        </button>

        {open && (
          <div className="panel absolute right-0 top-full z-50 mt-2 w-64 p-3 pop">
            <div className="stat-label px-1">Connected with {w.connectorName}</div>
            <div className="num mt-1 break-all px-1 text-[11px] text-slate-400">{w.address}</div>

            <div className="mt-3 grid gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(w.address ?? '');
                  play('confirm');
                }}
                className="btn btn-ghost w-full py-2 text-xs"
              >
                Copy address
              </button>
              <button
                onClick={() => {
                  play('back');
                  w.disconnect();
                  setOpen(false);
                }}
                className="btn btn-danger w-full py-2 text-xs"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          play('click');
          setOpen((o) => !o);
        }}
        className="btn btn-primary px-4 py-2 text-sm"
      >
        Connect wallet
      </button>

      {open && (
        <div className="panel panel-lit absolute right-0 top-full z-50 mt-2 w-72 p-3 pop">
          <div className="eyebrow px-1 pb-2">Choose a wallet</div>

          <div className="grid gap-2">
            {w.connectors.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  play('click');
                  c.connect();
                  setOpen(false);
                }}
                className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/[0.06]"
              >
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="h-6 w-6 rounded-md" />
                ) : (
                  <div className="grid h-6 w-6 place-items-center rounded-md bg-white/10 text-[10px] font-bold">
                    {c.name.slice(0, 1)}
                  </div>
                )}
                <span className="display text-sm font-semibold text-slate-200">{c.name}</span>
              </button>
            ))}
          </div>

          {w.connectError && (
            <p className="mt-2 px-1 text-[11px] text-[var(--danger)]">{w.connectError}</p>
          )}

          <p className="mt-3 px-1 text-[11px] leading-relaxed text-slate-500">
            Your wallet is your account. Every ticket you win is minted straight to it —
            nothing is held on our side.
          </p>
        </div>
      )}
    </div>
  );
}
