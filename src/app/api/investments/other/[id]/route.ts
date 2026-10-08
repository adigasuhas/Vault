import { NextRequest, NextResponse } from "next/server";
import { unfundPurchase } from "@/lib/investment-funding";
import type { Tx } from "@/lib/ledger";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { patchOtherAssetSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await context.params;

  const existing = await db.otherAsset.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let input;
  try {
    input = await parseJson(req, patchOtherAssetSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
  const { currentValue, notes } = input;

  const asset = await db.otherAsset.update({
    where: { id },
    data: {
      ...(currentValue !== undefined ? { currentValue } : {}),
      ...(notes !== undefined ? { notes } : {}),
    },
  });

  return NextResponse.json({ asset });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await context.params;

  const existing = await db.otherAsset.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // An asset added by mistake: whatever paid for it goes back.
  await db.$transaction(async (tx: Tx) => {
    await unfundPurchase(tx, session.userId, `ASSET:${id}`, existing.name);
    await tx.otherAsset.delete({ where: { id } });
  });
  return NextResponse.json({ success: true });
}
