import { NextRequest, NextResponse } from "next/server";
import { unfundPurchase } from "@/lib/investment-funding";
import { unlinkHolding } from "@/lib/investment-categories";
import type { Tx } from "@/lib/ledger";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await context.params;

  const existing = await db.fixedDeposit.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // A deposit added by mistake: whatever paid for it goes back.
  await db.$transaction(async (tx: Tx) => {
    await unfundPurchase(tx, session.userId, `DEPOSIT:${id}`, `${existing.bank} fixed deposit`);
    await unlinkHolding(tx, session.userId, "FIXED_DEPOSIT", id);
    await tx.fixedDeposit.delete({ where: { id } });
  });
  return NextResponse.json({ success: true });
}
