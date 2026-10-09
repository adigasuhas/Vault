import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { recomputeHoldingFromLots } from "@/lib/stocks";
import { unfundPurchase } from "@/lib/investment-funding";
import { editStock } from "@/lib/stock-edit";
import { unlinkHolding, unlinkLots } from "@/lib/investment-categories";
import type { Tx } from "@/lib/ledger";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { patchLotSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

async function getOwnedLot(userId: string, holdingId: string, lotId: string) {
  const lot = await db.stockPurchaseLot.findFirst({
    where: { id: lotId, stockHoldingId: holdingId, stockHolding: { userId } },
  });
  return lot;
}

/** Edits a single purchase within a stock holding — the fix for "I mistyped
 * one buy" without deleting and re-adding the whole position. Recomputes
 * the holding's aggregate quantity/avgBuyPrice afterward. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; lotId: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id, lotId } = await context.params;

  const lot = await getOwnedLot(session.userId, id, lotId);
  if (!lot) return NextResponse.json({ error: "Purchase not found." }, { status: 404 });

  let input;
  try {
    // Validates quantity/price bounds and that purchaseDate is a real date
    // (an invalid one used to reach Prisma and surface as a 500).
    input = await parseJson(req, patchLotSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }

  try {
    // Same path as editing the whole stock, so the two can't drift apart.
    const { holding } = await db.$transaction((tx: Tx) => editStock(tx, session.userId, id, { lots: [{ id: lotId, ...input }] }));
    return NextResponse.json({ holding });
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}

/** Removes one purchase from a holding — if it was the only one, the whole
 * holding goes with it (a holding can't exist with zero purchases). */
export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string; lotId: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id, lotId } = await context.params;

  const lot = await getOwnedLot(session.userId, id, lotId);
  if (!lot) return NextResponse.json({ error: "Purchase not found." }, { status: 404 });

  try {
    const holding = await db.$transaction(async (tx: Tx) => {
      // A purchase entered by mistake: what paid for it goes back.
      await unfundPurchase(tx, session.userId, `STOCK_LOT:${lotId}`, "Stock purchase");
      await tx.stockPurchaseLot.delete({ where: { id: lotId } });
      await unlinkLots(tx, session.userId, [lotId]);
      const left = await recomputeHoldingFromLots(id, tx);
      if (left === null) await unlinkHolding(tx, session.userId, "STOCK", id);
      return left;
    });
    return NextResponse.json({ holding, holdingDeleted: holding === null });
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
