import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { WalletProviders } from "@/components/wallet/WalletProviders";
import { WizardModalProvider } from "@/components/wizard/WizardModal";

// Variable font — the opsz axis is what the mockup's `opsz,wght@9..144,…` request loads.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Used ONLY for the "Parity" logotype (weight 800) — headings and body stay Fraunces.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: "800",
});

export const metadata: Metadata = {
  title: "Prime brokerage for tokenized stocks",
  description:
    "Earn yield, borrow against your position, and let an agent verify every step against real on-chain data before you sign.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${jetbrainsMono.variable} ${manrope.variable} antialiased`}>
      <body className="font-serif">
        <WalletProviders>
          <WizardModalProvider>{children}</WizardModalProvider>
        </WalletProviders>
      </body>
    </html>
  );
}
