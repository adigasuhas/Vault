import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

// Keep the pool small: on a serverless platform every warm function instance
// holds its own pool, so a large `max` multiplied across instances exhausts
// Postgres connections (finding A3). Point DATABASE_URL at a pooled endpoint
// (PgBouncer / Neon / Supabase pooler) in production and keep this modest.
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX || 5);

function createClient() {
  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      connectionString: process.env.DATABASE_URL,
      max: POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  globalForPrisma.pgPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Cache the client on the global in every environment (not just dev) so a
// reused serverless instance doesn't open a fresh pool per request.
export const db = globalForPrisma.prisma ?? createClient();
globalForPrisma.prisma = db;
