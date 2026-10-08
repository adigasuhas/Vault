import { NextRequest, NextResponse } from "next/server";
import { refundPurchase, unfundPurchase } from "@/lib/investment-funding";
import type { Tx } from "@/lib/ledger";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { patchStockSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await context.params;

  const existing = await db.stockHolding.findFirst({
    where: { id, userId: session.userId },
    include: { lots: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let input;
  try {
    input = await parseJson(req, patchStockSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
  const { quantity, avgBuyPrice, exchange } = input;

  const changingAggregate = quantity !== undefined || avgBuyPrice !== undefined;
  if (changingAggregate && existing.lots.length > 1) {
    return NextResponse.json(
      { error: "This holding is made of several purchases. Open its details and edit the purchase you want to fix." },
      { status: 409 }
    );
  }

  const quantityNum = quantity;
  const priceNum = avgBuyPrice;

  try {
  const holding = await db.$transaction(async (tx: Tx) => {
    // A single-lot holding is still one purchase — keep the lot and the
    // aggregate in sync so they never drift apart (and re-book what paid for it).
    if (changingAggregate && existing.lots.length === 1) {
      const lot = await tx.stockPurchaseLot.update({
        where: { id: existing.lots[0].id },
        data: {
          ...(quantityNum !== undefined ? { quantity: quantityNum } : {}),
          ...(priceNum !== undefined ? { price: priceNum } : {}),
        },
      });
      await refundPurchase(tx, session.userId, `STOCK_LOT:${lot.id}`, { cost: Number(lot.quantity) * Number(lot.price), currency: existing.currency, date: lot.purchaseDate, label: `${Number(lot.quantity)} ${existing.ticker}` });
    }

    return tx.stockHolding.update({
      where: { id },
      data: {
        ...(quantityNum !== undefined ? { quantity: quantityNum } : {}),
        ...(priceNum !== undefined ? { avgBuyPrice: priceNum } : {}),
        ...(exchange !== undefined ? { exchange: exchange || null } : {}),
      },
      include: { lots: { orderBy: { purchaseDate: "desc" } } },
    });
  });

  return NextResponse.json({ holding });
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await context.params;

  const existing = await db.stockHolding.findFirst({ where: { id, userId: session.userId }, include: { lots: true } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Removing a holding entered by mistake gives back whatever paid for it.
  try {
    await db.$transaction(async (tx: Tx) => {
      for (const lot of existing.lots) await unfundPurchase(tx, session.userId, `STOCK_LOT:${lot.id}`, `${existing.ticker} purchase`);
      await tx.stockHolding.delete({ where: { id } });
    });
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
  return NextResponse.json({ success: true });
}
