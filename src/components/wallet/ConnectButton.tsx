'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
/**
 * Position a popover under its trigger, clamped to the viewport.
 *
 * Returns `fixed` coordinates rather than relying on `absolute` inside the
 * trigger, because the trigger appears both in a header and in the middle of a
 * page, and an offset that is right in one place is wrong in the other. Flips
 * above the trigger when there isn't room below, and never lets either edge
 * leave the window.
 */
function usePopoverPlacement(
  anchor: React.RefObject<HTMLElement | null>,
  open: boolean,
  width: number,
) {
  const [style, setStyle] = useState<React.CSSProperties>({ top: -9999, left: -9999 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margin = 12;
      const w = Math.min(width, window.innerWidth - margin * 2);

      // Prefer below; flip above only when below genuinely doesn't fit.
      const below = window.innerHeight - r.bottom;
      const flip = below < 260 && r.top > below;

      // Right-align to the trigger, then clamp both edges into the window.
      let left = r.right - w;
      left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

      setStyle(
        flip
          ? { left, bottom: window.innerHeight - r.top + 8, width: w }
          : { left, top: r.bottom + 8, width: w },
      );
    };

    place();
    // Re-measure on anything that can move the trigger under the panel.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, open, width]);

  return { style, mounted };
}

/**
 * Render a popover into `document.body`.
 *
 * Left inside the header it is a child of a flex row, and a child of a flex row
 * can change that row's height — which is exactly what was happening: opening
 * the account menu made the nav grow taller and shunted the wallet chip upward.
 * A portal removes it from the layout entirely, so it cannot resize, wrap or be
 * clipped by any ancestor no matter how they are styled.
 */
function Popover({
  open,
  mounted,
  style,
  className,
  children,
  onOutside,
  anchor,
}: {
  open: boolean;
  mounted: boolean;
  style: React.CSSProperties;
  className: string;
  children: React.ReactNode;
  onOutside: () => void;
  anchor: React.RefObject<HTMLElement | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Held in a ref so the listener effect depends only on `open`. Passing the
  // callback directly re-binds document listeners on every parent render, which
  // is both wasteful and a good way to miss an event mid-rebind.
  const outside = useRef(onOutside);
  useEffect(() => {
    outside.current = onOutside;
  });

  useEffect(() => {
    if (!open) return;
    // The panel now lives outside the trigger, so a click inside it is no longer
    // "inside" the anchor — both have to be checked or it closes on its own.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      outside.current();
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && outside.current();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, anchor]);

  if (!open || !mounted) return null;

  return createPortal(
    <div ref={panel} style={style} className={className}>
      {children}
    </div>,
    document.body,
  );
}

export function ConnectButton({ compact }: { compact?: boolean }) {
  const w = useWallet();
  const { play } = useSound();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { style: placement, mounted } = usePopoverPlacement(ref, open, 288);

  /**
   * Connection state is not readable until after mount, and pretending
   * otherwise is a hydration error.
   *
   * wagmi restores a session from localStorage on the client, so the server
   * renders "disconnected" while the client's very first render can already be
   * "connected" — React sees two different trees and throws. Every branch below
   * is therefore gated on `ready`, which is false during SSR *and* during the
   * first client render, so both sides start from the identical connect button
   * and only diverge once an effect has run.
   *
   * The fallback is the connect button rather than a skeleton, deliberately: a
   * connect button shown a frame early is harmless, whereas a placeholder that
   * outlives its condition hides the one control that lets anybody in — which is
   * exactly what happened when this gated on a flag that never resolved.
   */
  if (w.ready && !w.isConnected && w.isReconnecting) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-sm border border-white/10 bg-white/[0.04] px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-500 pulse-dot" />
        <span className="display text-[11px] tracking-wider text-slate-500">Restoring…</span>
      </div>
    );
  }

  if (w.ready && w.isConnected && w.wrongNetwork) {
    return (
      <button
        onClick={() => {
          play('click');
          w.switchToTarget();
        }}
        disabled={w.switching}
        className="btn btn-danger h-9 shrink-0 px-3 text-xs"
      >
        {w.switching ? 'Switching…' : `Switch to ${w.chainLabel}`}
      </button>
    );
  }

  if (w.ready && w.isConnected && w.address) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => {
            play('click');
            setOpen((o) => !o);
          }}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-white/10 bg-white/[0.04] px-2.5 transition-colors hover:bg-white/[0.08]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
          <div className="text-left leading-tight">
            {!compact && (
              <div className="display text-[11px] font-semibold text-slate-200">{w.name}</div>
            )}
            <div className="num text-[10px] text-slate-500">{shortAddress(w.address)}</div>
          </div>
        </button>

        <Popover
          open={open}
          mounted={mounted}
          style={placement}
          anchor={ref}
          onOutside={() => setOpen(false)}
          className="panel fixed z-[100] max-w-[calc(100vw-1.5rem)] p-3 pop"
        >
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
        </Popover>
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
        className="btn btn-primary h-9 shrink-0 px-3 text-xs"
      >
        Connect wallet
      </button>

      {/*
        Anchored to the button, and clamped to the viewport.

        The previous version was `absolute right-0 top-full`, which is only
        correct when the button sits in a header. Rendered mid-page — as it is on
        the connect screen — `right-0` pushed the panel off the edge and nothing
        stopped it running past the bottom of the window, so the wallet list was
        either half off-screen or separated from the button by the rest of the
        page. `usePopoverPlacement` measures the button and pins the panel just
        below it (or just above, when there isn't room), horizontally clamped so
        it can never leave the screen.
      */}
      <Popover
        open={open}
        mounted={mounted}
        style={placement}
        anchor={ref}
        onOutside={() => setOpen(false)}
        className="panel panel-lit fixed z-[100] max-w-[calc(100vw-1.5rem)] p-3 pop"
      >
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
      </Popover>
    </div>
  );
}
