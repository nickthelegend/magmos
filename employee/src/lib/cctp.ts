// Circle CCTP v2 — recipient "Send home" cross-chain USDC bridge (Track-1 differentiator:
// "earned in Dubai, spendable at home"). Full loop: burn REAL Circle USDC on Arc via
// TokenMessengerV2.depositForBurn → poll Circle's Iris attestation API until the message
// is attested (capturing the message + attestation bytes) → mint on the destination chain
// by calling MessageTransmitterV2.receiveMessage(message, attestation) there.
//
// IMPORTANT — token nuance: Magmos streams a faucet-mintable TEST USDC
// (NEXT_PUBLIC_USDC). CCTP only bridges native Circle USDC, so this whole flow operates
// on REAL_USDC (0x3600…0000 on Arc), NOT the streamed token.
//
// depositForBurn v2 ABI VERIFIED against two authoritative sources (do NOT guess this):
//   1. Circle docs quickstart "Transfer USDC from Ethereum to Arc":
//      https://developers.circle.com/cctp/quickstarts/transfer-usdc-ethereum-to-arc
//   2. circlefin/evm-cctp-contracts TokenMessengerV2.sol (master):
//      https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol
//   Signature: depositForBurn(uint256 amount, uint32 destinationDomain,
//     bytes32 mintRecipient, address burnToken, bytes32 destinationCaller,
//     uint256 maxFee, uint32 minFinalityThreshold)
//   (v2 added destinationCaller, maxFee, minFinalityThreshold over v1.)

import { erc20Abi, pad, type Address, type Hex } from 'viem'
import { sepolia, avalancheFuji, arbitrumSepolia, baseSepolia } from 'viem/chains'
import { CCTP_TOKEN_MESSENGER, ARC_CCTP_DOMAIN } from './magmos'

export { ARC_CCTP_DOMAIN }

// ----- REAL Circle USDC on Arc -----
// CCTP can only burn native Circle USDC. On Arc that is the canonical 0x3600…0000 token.
// This is deliberately a separate constant from lib/magmos.ts `USDC` (which may be pointed
// at the faucet test token via NEXT_PUBLIC_USDC).
export const REAL_USDC = '0x3600000000000000000000000000000000000000' as Address
export const USDC_DECIMALS = 6

// TokenMessengerV2 on Arc (the CCTP contract that burns USDC). Sourced from lib/magmos.ts.
export const TOKEN_MESSENGER_V2 = CCTP_TOKEN_MESSENGER

// Circle Iris attestation service — testnet/sandbox. Poll by source domain + burn tx hash.
export const IRIS_SANDBOX_BASE = 'https://iris-api-sandbox.circle.com/v2'

// v2 finality thresholds (from Circle docs):
//   minFinalityThreshold <= 1000  → Fast Transfer (soft finality, ~seconds; small fee)
//   minFinalityThreshold  = 2000  → Standard Transfer (hard finality)
// We use the documented Fast-Transfer default so the demo attests quickly.
export const FINALITY_FAST = 1000
export const FINALITY_STANDARD = 2000

// maxFee is the max the sender will pay the fee-collector (raw 6-dec USDC). We default to a
// Standard Transfer (finality 2000), which allows a ZERO fee — so depositForBurn never reverts
// on a too-low maxFee. (Fast Transfer needs maxFee >= a bps-based fee that a flat cap like 500n
// undershoots for any non-trivial amount, reverting the burn.)
export const DEFAULT_MAX_FEE = 0n

// Empty bytes32 = "any caller may mint on the destination" (no destinationCaller lock).
export const NO_DESTINATION_CALLER =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

// ----- Destination chains the recipient can send home to -----
// Domain IDs VERIFIED against Circle docs "Supported Blockchains & Domains":
// https://developers.circle.com/cctp/concepts/supported-chains-and-domains

// MessageTransmitterV2 — the CCTP v2 contract you call receiveMessage() on to mint on the
// destination. Circle deploys the v2 contracts at the SAME address on every EVM chain
// (CREATE2). Address VERIFIED per destination testnet (Ethereum Sepolia, Avalanche Fuji,
// Arbitrum Sepolia, Base Sepolia — all `0xE737…E275`) against the "Testnet contract
// addresses" MessageTransmitterV2 table in Circle docs "EVM Smart Contracts":
//   https://developers.circle.com/cctp/evm-smart-contracts
// (It also matches Arc's CCTP_MESSAGE_TRANSMITTER in lib/magmos.ts, as expected.)
export const MESSAGE_TRANSMITTER_V2 = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as Address

// The viem chain objects for the four supported destinations. Typed as this literal union
// (not the loose `Chain`) so `viemChain.id` stays a literal chainId that satisfies the
// wagmi config's chain union in useSwitchChain / writeContract / waitForTransactionReceipt.
export type DestinationViemChain =
  | typeof sepolia
  | typeof avalancheFuji
  | typeof arbitrumSepolia
  | typeof baseSepolia

export interface DestinationChain {
  name: string
  domain: number
  icon: string // emoji glyph (kept dependency-free)
  short: string // ticker-ish label for compact UI
  viemChain: DestinationViemChain // wallet switch target, explorer + native-gas metadata
  messageTransmitter: Address // MessageTransmitterV2 on this destination (see note above)
}

export const DESTINATION_CHAINS: DestinationChain[] = [
  // prettier-ignore
  { name: 'Ethereum Sepolia', domain: 0, icon: 'Ξ', short: 'ETH', viemChain: sepolia, messageTransmitter: MESSAGE_TRANSMITTER_V2 },
  // prettier-ignore
  { name: 'Avalanche Fuji', domain: 1, icon: '▲', short: 'AVAX', viemChain: avalancheFuji, messageTransmitter: MESSAGE_TRANSMITTER_V2 },
  // prettier-ignore
  { name: 'Arbitrum Sepolia', domain: 3, icon: '◆', short: 'ARB', viemChain: arbitrumSepolia, messageTransmitter: MESSAGE_TRANSMITTER_V2 },
  // prettier-ignore
  { name: 'Base Sepolia', domain: 6, icon: '○', short: 'BASE', viemChain: baseSepolia, messageTransmitter: MESSAGE_TRANSMITTER_V2 },
]

// Explorer tx link on the destination chain (explorer URL comes from the viem chain
// definition: sepolia.etherscan.io / testnet.snowtrace.io / sepolia.arbiscan.io /
// sepolia.basescan.org).
export function destExplorerTx(dest: DestinationChain, hash: Hex): string {
  return `${dest.viemChain.blockExplorers.default.url}/tx/${hash}`
}

export function chainByDomain(domain: number): DestinationChain | undefined {
  return DESTINATION_CHAINS.find((c) => c.domain === domain)
}

// Left-pad a 20-byte EVM address into the 32-byte form CCTP expects for mintRecipient
// (and destinationCaller). viem's `pad` zero-fills on the left by default.
export function addressToBytes32(addr: Address): Hex {
  return pad(addr, { size: 32 })
}

// ----- write-request builders for wagmi useWriteContract -----

// Approve REAL Circle USDC spend by TokenMessengerV2 (required before depositForBurn).
export const approveRealUsdc = (amount: bigint) =>
  ({
    address: REAL_USDC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [TOKEN_MESSENGER_V2, amount],
  }) as const

// Minimal verified ABI fragment for TokenMessengerV2.depositForBurn (v2).
export const depositForBurnAbi = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [],
  },
] as const

// Build the depositForBurn request. `recipient` is the recipient's own address on the
// destination chain (they receive USDC there); mintRecipient is that address as bytes32.
export const depositForBurn = (
  amount: bigint,
  destinationDomain: number,
  recipient: Address,
  opts?: { maxFee?: bigint; minFinalityThreshold?: number; destinationCaller?: Hex },
) =>
  ({
    address: TOKEN_MESSENGER_V2,
    abi: depositForBurnAbi,
    functionName: 'depositForBurn',
    args: [
      amount,
      destinationDomain,
      addressToBytes32(recipient),
      REAL_USDC,
      opts?.destinationCaller ?? NO_DESTINATION_CALLER,
      opts?.maxFee ?? DEFAULT_MAX_FEE,
      opts?.minFinalityThreshold ?? FINALITY_STANDARD,
    ],
  }) as const

// Minimal verified ABI fragment for MessageTransmitterV2.receiveMessage (v2) — the
// destination-chain call that mints the USDC to the burn's mintRecipient.
// Signature VERIFIED against two authoritative sources (do NOT guess this):
//   1. Circle docs "Contract Interfaces" → MessageTransmitterV2:
//      https://developers.circle.com/cctp/references/contract-interfaces
//      receiveMessage(bytes message, bytes attestation)
//   2. circlefin/evm-cctp-contracts MessageTransmitterV2.sol (master):
//      https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/MessageTransmitterV2.sol
//      function receiveMessage(bytes calldata message, bytes calldata attestation)
//        external override whenNotPaused returns (bool success)
export const receiveMessageAbi = [
  {
    type: 'function',
    name: 'receiveMessage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const

// Build the receiveMessage request against the destination's MessageTransmitterV2.
// `message` + `attestation` are the bytes captured from Iris once status === "complete".
// Callers should pass `chainId: dest.viemChain.id` alongside so wagmi asserts the wallet
// is actually on the destination chain (switch first via useSwitchChain).
export const receiveMessage = (dest: DestinationChain, message: Hex, attestation: Hex) =>
  ({
    address: dest.messageTransmitter,
    abi: receiveMessageAbi,
    functionName: 'receiveMessage',
    args: [message, attestation],
  }) as const

// ----- Iris attestation polling -----

export type AttestationStatus = 'pending' | 'complete'

export interface AttestationResult {
  status: AttestationStatus
  message: Hex | null // the CCTP message bytes (for receiveMessage on the destination)
  attestation: Hex | null // Circle's signed attestation (for receiveMessage)
  eventNonce?: string
}

interface IrisMessage {
  status?: string // "pending_confirmations" | "complete" | ...
  message?: string
  attestation?: string
  eventNonce?: string
}
interface IrisResponse {
  messages?: IrisMessage[]
  error?: string
}

// Do a single Iris query for the given source domain + burn tx hash. Returns null when
// Iris has not indexed the burn yet (HTTP 404 during the first ~seconds is normal).
export async function fetchAttestationOnce(
  sourceDomain: number,
  txHash: Hex,
): Promise<AttestationResult | null> {
  const url = `${IRIS_SANDBOX_BASE}/messages/${sourceDomain}?transactionHash=${txHash}`
  const res = await fetch(url, { method: 'GET' })
  // 404 = not indexed yet. Anything else non-OK is a soft error we retry through.
  if (!res.ok) return null
  const data = (await res.json()) as IrisResponse
  const msg = data.messages?.[0]
  if (!msg) return null
  // Circle marks a message ready when status === "complete". Every other value
  // (e.g. "pending_confirmations") means keep waiting.
  const ready = msg.status === 'complete' && !!msg.attestation && msg.attestation !== 'PENDING'
  return {
    status: ready ? 'complete' : 'pending',
    message: (msg.message as Hex) ?? null,
    attestation: ready ? ((msg.attestation as Hex) ?? null) : null,
    eventNonce: msg.eventNonce,
  }
}

export interface PollOptions {
  intervalMs?: number // between polls (default 5s, matches Circle quickstarts)
  timeoutMs?: number // give up after this (default 20 min)
  onStatus?: (status: AttestationStatus, elapsedMs: number) => void
  signal?: AbortSignal // cancel from the UI (e.g. modal closed)
}

// Poll Iris until the attestation is `complete` (ready to mint on the destination chain)
// or we time out. Source domain is Arc (26) because the burn happens on Arc.
export async function pollAttestation(
  txHash: Hex,
  options: PollOptions = {},
): Promise<AttestationResult> {
  const intervalMs = options.intervalMs ?? 5_000
  const timeoutMs = options.timeoutMs ?? 20 * 60_000
  const started = Date.now()

  while (true) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const elapsed = Date.now() - started
    if (elapsed > timeoutMs) {
      throw new Error('Timed out waiting for Circle attestation. It may still complete later.')
    }

    let result: AttestationResult | null = null
    try {
      result = await fetchAttestationOnce(ARC_CCTP_DOMAIN, txHash)
    } catch {
      // network hiccup — swallow and retry on the next tick
      result = null
    }

    if (result?.status === 'complete') {
      options.onStatus?.('complete', elapsed)
      return result
    }
    options.onStatus?.('pending', elapsed)

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs)
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    })
  }
}
