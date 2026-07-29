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
