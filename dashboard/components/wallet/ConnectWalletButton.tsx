"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { shortAddress } from "@/lib/wallet";

/**
 * Every "Connect Wallet" entry point in the app renders this one component.
 *
 *   disconnected → gold "Connect Wallet" button; click opens the wallet-adapter modal
 *   connecting   → "Connecting…" (disabled) while the extension prompt is open / auto-reconnecting
 *   connected    → the real public key, truncated ("7fL9k2...mQ4p"); click opens a small menu with
 *                  "Copy address" and "Disconnect"
 *
 * Scope (this phase): connect / disconnect only. No signing and no transactions — the public key is
 * simply available to the rest of the app through `useWallet()`.
 *
 * `size` picks the geometry (nav / hero / closing CTA); `tone` picks the palette for where it sits
 * ("light" = the landing page's paper nav, "dark" = the Trade page's terminal nav).
 */

type Size = "nav" | "hero" | "cta";
type Tone = "light" | "dark";

const GEOMETRY: Record<Size, Record<Tone, string>> = {
  nav: {
    // The mockup's 16px/28px/15px button doesn't fit a 375px header next to the logo and menu button,
    // so it steps up to the design size at lg. The dark (Trade) nav stays compact, like its old chip.
    // 1px less vertical padding than before at each step: the always-present 1px border adds 2px, so the
    // header keeps its previous heights (73 / 101 / 110px).
    light: "rounded-lg px-[14px] py-[9px] text-[13px] md:px-[20px] md:py-[11px] md:text-[14px] lg:px-[28px] lg:py-[15px] lg:text-[15px]",
    // Same height as the old static chip (38px), so the Trade header stays 94px.
    dark: "rounded-md px-[14px] py-[7px] text-[13px] leading-[20px] md:px-[16px]",
  },
  hero: { light: "rounded-lg w-full px-[28px] py-[15px] text-[15px] sm:w-auto", dark: "rounded-lg w-full px-[28px] py-[15px] text-[15px] sm:w-auto" },
  cta: { light: "rounded-[30px] w-full px-[30px] py-[15px] text-[15px] sm:w-auto", dark: "rounded-[30px] w-full px-[30px] py-[15px] text-[15px] sm:w-auto" },
};

const DISCONNECTED: Record<Size, Record<Tone, string>> = {
  nav: { light: "bg-gold-deep text-gold-ink hover:bg-gold-text", dark: "bg-gold text-gold-ink hover:bg-[#eec468]" },
  hero: { light: "bg-gold-deep text-gold-ink hover:bg-gold-text", dark: "bg-gold text-gold-ink hover:bg-[#eec468]" },
  // Over the closing-CTA photo: bright gold pill.
  cta: { light: "bg-gold text-gold-ink hover:bg-gold-deep", dark: "bg-gold text-gold-ink hover:bg-gold-deep" },
};

const CONNECTED: Record<Size, Record<Tone, string>> = {
  nav: {
    light: "border-line-strong bg-surface text-ink hover:border-gold-deep",
    dark: "border-term-control bg-term-surface text-term-text hover:border-gold",
  },
  hero: {
    light: "border-line-strong bg-surface text-ink hover:border-gold-deep",
    dark: "border-term-control bg-term-surface text-term-text hover:border-gold",
  },
  cta: { light: "border-white/50 bg-white/10 text-white backdrop-blur hover:border-white", dark: "border-white/50 bg-white/10 text-white backdrop-blur hover:border-white" },
};

const MENU: Record<Tone, { panel: string; item: string; muted: string }> = {
  light: { panel: "border-line bg-surface", item: "text-ink hover:bg-paper", muted: "text-ink-muted" },
  dark: { panel: "border-term-control bg-term-surface", item: "text-term-text hover:bg-term-raised", muted: "text-term-muted" },
};

function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""} ${className}`}>
      <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const DEFAULT_LABEL = "Connect Wallet";

export function ConnectWalletButton({
  size = "nav",
  tone = "light",
  children = DEFAULT_LABEL,
}: {
  size?: Size;
  tone?: Tone;
  children?: ReactNode;
}) {
  const { publicKey, connected, connecting, disconnecting, wallet, disconnect, select } = useWallet();
  const { setVisible } = useWalletModal();

  // Until mounted, always render the disconnected button so server HTML and first client render match
  // (the wallet extension and any auto-reconnect only exist in the browser).
  // (useSyncExternalStore: false on the server and during hydration, true once on the client.)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const address = mounted && connected && publicKey ? publicKey.toBase58() : null;
  const nav = size === "nav";
  // The header row (logo + wallet + hamburger) has a fixed minimum width, so on small phones the wallet
  // button slims down in steps — measured against a 305px content width (a "320px" window with a
  // classic scrollbar): label "Connect" below 390px, no status dot / chevron below 420px, and a shorter
  // address below 370px. (Media queries see the full window width, scrollbar included, hence the margins.)
  // Every state has a 1px border (transparent while disconnected) so the box is the same size in both
  // states — connecting must never change the header's height.
  const base = `shrink-0 cursor-pointer whitespace-nowrap border font-mono font-medium ${GEOMETRY[size][tone]}`;

  if (!address) {
    const busy = mounted && (connecting || disconnecting);
    return (
      <div data-wallet-state={busy ? "connecting" : "disconnected"}>
        <button
          type="button"
          disabled={busy}
          onClick={() => setVisible(true)}
          className={`${base} border-transparent ${DISCONNECTED[size][tone]} disabled:cursor-wait disabled:opacity-70`}
        >
          {busy ? "Connecting…" : nav && children === DEFAULT_LABEL ? (
            <>
              Connect<span className="max-[389px]:hidden"> Wallet</span>
            </>
          ) : (
            children
          )}
        </button>
      </div>
    );
  }

  const menu = MENU[tone];
  const disconnectNow = async () => {
    setOpen(false);
    try {
      await disconnect();
    } finally {
      // Also forget the selected wallet. Without this the selection stays in localStorage and
      // autoConnect would silently reconnect on the next page load — i.e. "disconnect" would only
      // have hidden the state, not cleared it.
      // (select(null) makes the provider disconnect the outgoing adapter itself, so the wallet gets a
      // second, harmless disconnect() — wallets ignore a disconnect when already disconnected.)
      select(null);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context / permission) — nothing to do */
    }
  };

  return (
    <div ref={root} className="relative shrink-0" data-wallet-state="connected">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Wallet ${address} — open menu`}
        onClick={() => setOpen((o) => !o)}
        className={`${base} flex items-center gap-[8px] ${CONNECTED[size][tone]}`}
      >
        <span aria-hidden="true" className={`inline-block size-[8px] shrink-0 rounded-full bg-positive ${nav ? "max-[419px]:hidden" : ""}`} />
        <span data-wallet-address>
          {nav ? (
            <>
              <span className="max-[369px]:hidden">{shortAddress(address)}</span>
              <span className="hidden max-[369px]:inline">{shortAddress(address, 4)}</span>
            </>
          ) : (
            shortAddress(address)
          )}
        </span>
        <Chevron open={open} className={nav ? "max-[419px]:hidden" : ""} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Wallet"
          className={`absolute right-0 top-full z-[60] mt-2 min-w-[220px] rounded-xl border p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] ${menu.panel}`}
        >
          <div className={`px-3 pb-2 pt-1.5 font-mono text-[11px] ${menu.muted}`}>Connected with {wallet?.adapter.name ?? "wallet"}</div>
          <button type="button" role="menuitem" onClick={copy} className={`flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left font-mono text-[13px] ${menu.item}`}>
            <span>Copy address</span>
            <span aria-live="polite" className={menu.muted}>{copied ? "Copied" : ""}</span>
          </button>
          <button type="button" role="menuitem" onClick={disconnectNow} className={`flex w-full cursor-pointer items-center rounded-lg px-3 py-2.5 text-left font-mono text-[13px] text-clay-text hover:bg-clay-tint/60 ${tone === "dark" ? "hover:text-clay" : ""}`}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
