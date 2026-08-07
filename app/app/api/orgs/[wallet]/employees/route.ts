// GET  /api/orgs/[wallet]/employees — list employees for an org (public read).
// POST /api/orgs/[wallet]/employees — add/update one employee (wallet-signed).
//
// Employee metadata mirror for the on-chain payroll roster. { orgWallet,
// walletAddress, name, email?, monthlyUsdc, group? }. Keyed by (orgWallet,
// walletAddress) so re-adding the same recipient updates in place.

import { NextResponse, type NextRequest } from 'next/server'
import { isAddress } from 'viem'
import { getDb, COLLECTIONS } from '@/lib/mongo'
import { requireOwner } from '@/lib/auth'

export const runtime = 'nodejs'

type Params = { params: Promise<{ wallet: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }
  const db = await getDb()
  const rows = await db
    .collection(COLLECTIONS.employees)
    .find({ orgWallet: wallet.toLowerCase() }, { projection: { _id: 0 } })
    .toArray()
  // Collapse the meta-address to a boolean. The keys are public, but the employer only needs to know
  // whether this person can be paid confidentially — and shipping the raw points invites a client to
  // start deriving stealth addresses, which is the server's job and must stay in one place.
  return NextResponse.json(
    rows.map(({ stealthMeta, ...rest }) => ({
      ...rest,
      privatePayoutReady: Boolean(stealthMeta?.spendingPubKey && stealthMeta?.viewingPubKey),
    }))
  )
}

export async function POST(req: NextRequest, { params }: Params) {
  const { wallet } = await params
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }

  const auth = await requireOwner(req, wallet)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    walletAddress?: string
    name?: string
    email?: string
    monthlyUsdc?: number
    group?: string
  }

  const walletAddress = (body.walletAddress ?? '').trim()
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 })
  }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const monthlyUsdc = Number(body.monthlyUsdc ?? 0)

  const orgWallet = wallet.toLowerCase()
  const recipient = walletAddress.toLowerCase()
  const doc = {
    orgWallet,
    walletAddress: recipient,
    name,
    email: body.email ?? null,
    monthlyUsdc: Number.isFinite(monthlyUsdc) ? monthlyUsdc : 0,
    group: body.group ?? null,
    updatedAt: new Date().toISOString(),
  }

  const db = await getDb()
  await db
    .collection(COLLECTIONS.employees)
    .updateOne(
      { orgWallet, walletAddress: recipient },
      { $set: doc, $setOnInsert: { createdAt: new Date().toISOString() } },
      { upsert: true }
    )
  return NextResponse.json(doc, { status: 201 })
}
