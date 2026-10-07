import { NextRequest, NextResponse } from "next/server";
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

  const asset = await db.otherAsset.create({
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

  return NextResponse.json({ asset }, { status: 201 });
}
