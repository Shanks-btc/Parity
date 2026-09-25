"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";
import { useMemo, type ReactNode } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Wallet context for the whole app: after this phase any component can read the connected public
 * key via `useWallet().publicKey` (and, in later phases, request signatures from the same hook).
 *
 * MAINNET ONLY, deliberately: the backend reads real mainnet data everywhere and every simulation
 * and check runs against mainnet, so a devnet wallet would see none of the same state. There is no
 * network switcher in this build (see the phase report for the open decision on one).
 *
 * RPC: NEXT_PUBLIC_SOLANA_RPC_URL, set to the same value as the backend's SOLANA_RPC_URL. Note
 * NEXT_PUBLIC_ variables are compiled into the browser bundle, so this must never hold a
 * key-bearing URL that isn't domain-restricted. Connecting and disconnecting make NO RPC calls
 * (the wallet extension does that work); the endpoint only matters once later phases read balances
 * or submit transactions from the browser.
 */
const RPC_ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta");

// Stored under an app-specific key so another app on the same origin (e.g. another localhost dev
// server) can't clobber or read this selection.
const WALLET_STORAGE_KEY = "parity.wallet";

export function WalletProviders({ children }: { children: ReactNode }) {
  // Phantom and Solflare are listed explicitly; any other Wallet-Standard wallet the visitor has
  // installed is detected automatically and appears in the modal too.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider
        wallets={wallets}
        autoConnect
        localStorageKey={WALLET_STORAGE_KEY}
        onError={(error) => {
          // Rejected prompts, closed popups and missing extensions all land here; the UI simply stays
          // disconnected, so a warning in the console is enough for now.
          console.warn(`[wallet] ${error.name}: ${error.message}`);
        }}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
