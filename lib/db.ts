// Prisma client for Munim's own tables (prisma/schema.prisma). Prisma 7 runs without a Rust query
// engine: queries go through the node-postgres driver adapter. One instance per server process;
// in dev, hot reload would otherwise open a new pool on every change.

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/munim';
  // Render's external Postgres URLs need TLS; its internal ones and localhost don't.
  const ssl = /render\.com/.test(connectionString) ? { rejectUnauthorized: false } : undefined;
  // DATABASE_POOL_MAX caps connections (small Render databases allow few).
  const max = Number(process.env.DATABASE_POOL_MAX) || undefined;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, ssl, max }) });
}

export const db = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

/** Munim's features need a database; the boilerplate pages don't. */
export const dbEnabled = () => Boolean(process.env.DATABASE_URL);

export async function getSettings() {
  return db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export type Settings = Awaited<ReturnType<typeof getSettings>>;
