// wagmi + viem setup for Arc testnet. Replaces the Sui dapp-kit client config.
//
// Besides Arc (the app's primary chain), the config registers the four CCTP v2
// destination testnets the recipient can "send home" to. Registering them lets
// useSwitchChain move the injected wallet there (the connector falls back to
// wallet_addEthereumChain when the wallet doesn't know the chain yet) for the final
// MessageTransmitterV2.receiveMessage mint, and lets @wagmi/core actions wait for the
// destination-side receipt. viem/chains default public RPCs are fine for that one call.

import { http, createConfig, createStorage, cookieStorage } from 'wagmi'
import { defineChain } from 'viem'
import { sepolia, avalancheFuji, arbitrumSepolia, baseSepolia } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_WS_URL, ARC_EXPLORER, MULTICALL3 } from './magmos'

/// Arc testnet. Native gas token is USDC (18-dec native); the ERC-20 USDC used for
/// payroll is a separate 6-dec token (see lib/magmos.ts USDC).
export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL], webSocket: [ARC_WS_URL] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: ARC_EXPLORER },
  },
  contracts: {
    multicall3: { address: MULTICALL3 },
  },
  testnet: true,
})

// wagmi's public reads (useReadContract, waitForTransactionReceipt, estimateGas) travel over this
// transport. Pointed straight at Arc it fetches cross-origin from the browser, which the node
// rejects with CORS *and* counts against its per-IP concurrency limit. Same-origin /api/rpc solves
// both: it is allow-listed to read-only methods, cached, and coalesced. Signing is unaffected —
// that always goes through the injected wallet, never this transport.
const ARC_READ_RPC = typeof window === 'undefined' ? ARC_RPC_URL : '/api/rpc'

export const wagmiConfig = createConfig({
  // arcTestnet FIRST — the app's primary chain. The rest are CCTP v2 mint destinations.
  chains: [arcTestnet, sepolia, avalancheFuji, arbitrumSepolia, baseSepolia],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(ARC_READ_RPC, { retryCount: 3, retryDelay: 250 }),
    // Destination testnets use their viem/chains default public RPCs — only exercised for
    // the destination-side receiveMessage mint + receipt wait.
    [sepolia.id]: http(),
    [avalancheFuji.id]: http(),
    [arbitrumSepolia.id]: http(),
    [baseSepolia.id]: http(),
  },
  // SSR-safe hydration for Next.js
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
