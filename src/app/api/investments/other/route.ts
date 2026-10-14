import { NextRequest, NextResponse } from "next/server";
import { fundPurchase, fundingFrom } from "@/lib/investment-funding";
import { claimRequest, lostRace, requestSeen, settleRequest } from "@/lib/request-keys";
import type { Tx } from "@/lib/ledger";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { createOtherAssetSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const assets = await db.otherAsset.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ assets });
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let input;
  try {
    input = await parseJson(req, createOtherAssetSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
  const replay = await requestSeen(session.userId, input.idempotencyKey);
  if (replay) return NextResponse.json({ duplicate: true, id: replay.resultId }, { status: 200 });

  let asset;
  try {
    asset = await db.$transaction(async (tx: Tx) => {
      await claimRequest(tx, session.userId, input.idempotencyKey, "ASSET_PURCHASE");
      const a = await tx.otherAsset.create({
        data: {
          userId: session.userId,
          assetType: input.assetType,
          name: input.name,
          quantity: input.quantity,
          unit: input.unit,
          purchasePrice: input.purchasePrice,
          currentValue: input.currentValue,
          currency: input.currency,
          purchaseDate: input.purchaseDate,
          notes: input.notes,
        },
      });
      await fundPurchase(
        tx,
        session.userId,
        `ASSET:${a.id}`,
        { cost: input.purchasePrice, currency: input.currency, date: input.purchaseDate, label: input.name },
        fundingFrom(input)
      );
      await settleRequest(tx, session.userId, input.idempotencyKey, a.id);
      return a;
    });
  } catch (err) {
    const won = await lostRace(err, session.userId, input.idempotencyKey);
    if (won) return NextResponse.json({ duplicate: true, id: won.resultId }, { status: 200 });
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }

  return NextResponse.json({ asset }, { status: 201 });
}
