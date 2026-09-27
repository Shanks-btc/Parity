import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, Page, PageHeader } from "@/components/app/AppShell";
import { BorrowForm } from "@/components/borrow/BorrowForm";

export const metadata: Metadata = {
  title: "Parity, Borrow",
  description: "Supply an xStock as collateral on Kamino and borrow USDC, with the exact transaction simulated on mainnet before you sign.",
};

export default function BorrowPage() {
  return (
    <AppShell active="borrow">
      <Page>
        <PageHeader
          eyebrow="BORROW · FLOATING RATE"
          title="Borrow USDC against your stock"
          subtitle="Supply AAPLx, SPYx or TSLAx as collateral on Kamino Lend and borrow USDC without selling. Every number below comes from Kamino's live market, and you see the simulated result before anything is signed."
        />
        <Suspense fallback={null}>
          <BorrowForm />
        </Suspense>
      </Page>
    </AppShell>
  );
}
