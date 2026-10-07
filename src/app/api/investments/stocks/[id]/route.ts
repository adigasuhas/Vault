import { NextRequest, NextResponse } from "next/server";
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

  const holding = await db.$transaction(async (tx) => {
    // A single-lot holding is still one purchase — keep the lot and the
    // aggregate in sync so they never drift apart.
    if (changingAggregate && existing.lots.length === 1) {
      await tx.stockPurchaseLot.update({
        where: { id: existing.lots[0].id },
        data: {
          ...(quantityNum !== undefined ? { quantity: quantityNum } : {}),
          ...(priceNum !== undefined ? { price: priceNum } : {}),
        },
      });
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
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await context.params;

  const existing = await db.stockHolding.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await db.stockHolding.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
