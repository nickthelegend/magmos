// @magmos/sdk — drop-in USDC checkout for the Arc network.

export { MagmosPayButton, type MagmosPayButtonProps } from "./MagmosPayButton";
export { PayModal, type PayModalProps } from "./PayModal";
export { MagmosProvider } from "./MagmosProvider";

export { fetchCheckoutConfig, DEFAULT_API_BASE } from "./config";
export { buildPaymentRequest } from "./payment";
export { TOKENS, SUPPORTED_TOKENS, type TokenConfig, type TokenSymbol } from "./tokens";
export type { CheckoutConfig, PaymentResult, MagmosNetwork } from "./types";
export {
  MAGMOS_ADVANCE_ADDRESS,
  advanceAbi,
  getDrawable,
  quoteAdvance,
  getAdvanceAccount,
  buildDrawRequest,
  type AdvanceQuote,
  type AdvanceAccount,
} from "./advance";

// ---- confidential payouts (stealth addresses) ----
// Pure crypto: derive a meta-address, create one-time payment addresses, and let a recipient
// reconstruct their own claim from chain logs. No backend involved.
export {
  deriveStealthKeys,
  stealthDerivationMessage,
  createStealthPayment,
  checkAnnouncement,
  reconstructClaim,
  encryptAmount,
  decryptAmount,
  isSealedAddress,
  payoutLeaf,
  buildMerkleTree,
  merkleProof,
  verifyProof,
  claimTypedData,
  type StealthKeys,
  type StealthMetaAddress,
  type StealthPayment,
} from "./stealth";
