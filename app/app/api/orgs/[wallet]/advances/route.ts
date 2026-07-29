import { NextResponse, type NextRequest } from 'next/server'
import { isAddress, parseAbiItem, createPublicClient, http } from 'viem'
import { arcTestnet } from '@/lib/wagmi'
import { MAGMOS_ADVANCE, USDC_DECIMALS, poolIdFor, USDC, ARC_RPC_URL } from '@/lib/magmos'

export const runtime = 'nodejs'

type Params = { params: Promise<{ wallet: string }> }

const client = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) })

const advanceDrawn = parseAbiItem(
  'event AdvanceDrawn(bytes32 indexed poolId, address indexed worker, uint256 amount, uint256 fee, uint256 subsidizedByYield, uint256 netToWorker, uint256 remainingClaimable, uint256 timestamp)'
)

/**
 * Earned-wage-advance history for an org's pool.
 *
 * Server-side because Arc caps `eth_getLogs` at a 10,000-block range: the browser can only afford
 * one window, but here we can walk several sequentially (and the shared /api/rpc cache absorbs the
 * cost for every viewer). Read-only and public — the same information the block explorer exposes.
 *
 * Query: ?windows=6  (each window is 9,000 blocks; default 4)
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }

  const windows = Math.min(12, Math.max(1, Number(req.nextUrl.searchParams.get('windows')) || 4))
  const poolId = poolIdFor(wallet as `0x${string}`, USDC)

  try {
    const latest = await client.getBlockNumber()
    const span = 9_000n
    const rows: unknown[] = []

    for (let i = 0; i < windows; i++) {
      const toBlock = latest - span * BigInt(i)
      if (toBlock <= 0n) break
      const fromBlock = toBlock > span ? toBlock - span : 0n
      const logs = await client
        .getLogs({ address: MAGMOS_ADVANCE, event: advanceDrawn, args: { poolId }, fromBlock, toBlock })
        .catch(() => [])
      for (const l of logs) {
        rows.push({
          worker: l.args.worker,
          amount: Number(l.args.amount as bigint) / 10 ** USDC_DECIMALS,
          fee: Number(l.args.fee as bigint) / 10 ** USDC_DECIMALS,
          subsidizedByYield: Number(l.args.subsidizedByYield as bigint) / 10 ** USDC_DECIMALS,
          netToWorker: Number(l.args.netToWorker as bigint) / 10 ** USDC_DECIMALS,
          timestamp: Number(l.args.timestamp as bigint),
          txHash: l.transactionHash,
          blockNumber: Number(l.blockNumber),
        })
      }
      if (fromBlock === 0n) break
    }

    rows.sort(
      (a, b) => (b as { blockNumber: number }).blockNumber - (a as { blockNumber: number }).blockNumber
    )
    return NextResponse.json({
      poolId,
      scannedBlocks: Number(span) * windows,
      count: rows.length,
      advances: rows,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 160) }, { status: 502 })
  }
}
