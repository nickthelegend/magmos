import { NextResponse, type NextRequest } from 'next/server'
import { isAddress } from 'viem'
import { poolIdFor, USDC, USDC_DECIMALS } from '@/lib/magmos'
import { getSolvencySnapshot } from '@/lib/reads'

export const runtime = 'nodejs'

type Params = { params: Promise<{ wallet: string }> }

const usd = (raw: bigint) => Number(raw) / 10 ** USDC_DECIMALS

/**
 * Whether an org's payroll can actually pay what it already owes.
 *
 * Machine-readable version of the dashboard's coverage card, so this can be alerted on rather than
 * eyeballed: point a monitor at it and page someone when `covered` drops below 1. The contract does
 * not enforce coverage — `claim()` just reverts when the pool runs dry — which is exactly why this
 * needs to be observable outside the UI.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }
  const poolId = poolIdFor(wallet as `0x${string}`, USDC)

  try {
    const { pool, liability, exposure, stats } = await getSolvencySnapshot(poolId)
    if (!pool.exists) {
      return NextResponse.json({ poolId, exists: false }, { status: 404 })
    }

    const covered =
      liability.accrued === 0n ? 1 : Number((pool.balance * 10_000n) / liability.accrued) / 10_000

    return NextResponse.json({
      poolId,
      exists: true,
      healthy: liability.shortfall === 0n,
      covered: Number(covered.toFixed(4)),
      balance: usd(pool.balance),
      accruedUnclaimed: usd(liability.accrued),
      shortfall: usd(liability.shortfall),
      totalDeposited: usd(pool.totalDeposited),
      totalClaimed: usd(pool.totalClaimed),
      earnedWageAccess: {
        workers: Number(exposure.workers),
        drawableNow: usd(exposure.drawableNow),
        advancedLifetime: usd(stats.drawn),
        feesCharged: usd(stats.feesCharged),
        feesCoveredByYield: usd(stats.feesSubsidized),
        feesPaidByWorkers: usd(stats.feesOnWorkers),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 160) }, { status: 502 })
  }
}
