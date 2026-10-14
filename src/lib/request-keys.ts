import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Tx } from "@/lib/ledger";

/**
 * Idempotency for create requests (investment purchases, investment-cash
 * moves). The form sends one key per session; the first request to claim it
 * does the work, and a repeat (double submit, retry after a dropped
 * response) finds the claim and changes nothing.
 *
 *   const seen = await requestSeen(userId, key);       // fast path
 *   if (seen) return replay(seen);
 *   try { await db.$transaction(async (tx) => { await claimRequest(tx, ...); ... }) }
 *   catch (e) { const won = await lostRace(e, userId, key); if (won) return replay(won); throw e; }
 */

export async function requestSeen(userId: string, key: string | undefined | null) {
  if (!key) return null;
  return db.requestKey.findUnique({ where: { userId_key: { userId, key } } });
}

/** Claims the key inside the caller's transaction (first statement, so a
 * duplicate fails before anything is written). */
export async function claimRequest(tx: Tx, userId: string, key: string | undefined | null, scope: string) {
  if (!key) return;
  await tx.requestKey.create({ data: { userId, key, scope } });
}

/** Records what the request created, for replays to report. */
export async function settleRequest(tx: Tx, userId: string, key: string | undefined | null, resultId: string) {
  if (!key) return;
  await tx.requestKey.update({ where: { userId_key: { userId, key } }, data: { resultId } });
}

/** After a failed transaction: the claim that beat this one, if the failure
 * was two copies of the same request racing. */
export async function lostRace(err: unknown, userId: string, key: string | undefined | null) {
  if (!key || !(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  return requestSeen(userId, key);
}
