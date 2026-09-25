/**
 * The devnet transaction that proves the sign → submit → confirm pipeline (`npm run
 * check:send-devnet`, 2026-09-24): a 1-lamport self-transfer, finalized at devnet slot 503430923
 * with no error. Re-verified via getSignatureStatuses / getTransaction on 2026-09-24.
 */
export const DEVNET_PROOF_SIGNATURE =
  "njdQBENCWCmY47bMTmHYyX9XxQLBAzoNMpWqrmo5K2r5iowDFucEY2vWUrPaeCDcrVqjQosYE6SfK38BtWzHsh6";

export const DEVNET_PROOF_URL = `https://explorer.solana.com/tx/${DEVNET_PROOF_SIGNATURE}?cluster=devnet`;

/** "njdQBENC…tWzHsh6" — first 8 and last 7 characters, as in the design. */
export const DEVNET_PROOF_SHORT = `${DEVNET_PROOF_SIGNATURE.slice(0, 8)}…${DEVNET_PROOF_SIGNATURE.slice(-7)}`;
