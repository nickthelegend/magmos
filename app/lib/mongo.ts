// MongoDB connection singleton for Next.js API routes (server-only).
// Caches the client across HMR in dev and across warm invocations in prod.

import { MongoClient, type Db } from 'mongodb'

const uri = process.env.MONGODB_URI
const dbName = process.env.MONGODB_DB || 'magmos'

declare global {
  var _magmosMongo: Promise<MongoClient> | undefined
}

let clientPromise: Promise<MongoClient> | undefined

function getClientPromise(): Promise<MongoClient> {
  if (!uri) throw new Error('MONGODB_URI is not set (server env)')
  if (process.env.NODE_ENV === 'development') {
    if (!global._magmosMongo) {
      global._magmosMongo = new MongoClient(uri).connect()
    }
    return global._magmosMongo
  }
  if (!clientPromise) clientPromise = new MongoClient(uri).connect()
  return clientPromise
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise()
  return client.db(dbName)
}

// Collection name constants — single source of truth.
export const COLLECTIONS = {
  orgs: 'orgs',
  employees: 'employees',
  groups: 'groups',
  invoices: 'invoices',
  apiKeys: 'apiKeys',
  webhooks: 'webhooks',
} as const
