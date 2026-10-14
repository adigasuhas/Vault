import { NextRequest, NextResponse } from "next/server";
import { fundPurchase, fundingFrom } from "@/lib/investment-funding";
import { claimRequest, lostRace, requestSeen, settleRequest } from "@/lib/request-keys";
import type { Tx } from "@/lib/ledger";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { createDepositSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const deposits = await db.fixedDeposit.findMany({
    where: { userId: session.userId },
    include: { linkedAccount: true },
    orderBy: { maturityDate: "asc" },
  });
  return NextResponse.json({ deposits });
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let input;
  try {
    input = await parseJson(req, createDepositSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
  const replay = await requestSeen(session.userId, input.idempotencyKey);
  if (replay) return NextResponse.json({ duplicate: true, id: replay.resultId }, { status: 200 });

  if (input.maturityDate <= input.startDate) {
    return NextResponse.json({ error: "Maturity date must be after the start date." }, { status: 422 });
  }

  if (input.linkedAccountId) {
    const account = await db.account.findFirst({ where: { id: input.linkedAccountId, userId: session.userId } });
    if (!account) return NextResponse.json({ error: "Linked account not found." }, { status: 404 });
  }

  try {
    const deposit = await db.$transaction(async (tx: Tx) => {
      await claimRequest(tx, session.userId, input.idempotencyKey, "DEPOSIT_PURCHASE");
      const d = await tx.fixedDeposit.create({
        data: {
          userId: session.userId,
          bank: input.bank,
          principal: input.principal,
          interestRate: input.interestRate,
          startDate: input.startDate,
          maturityDate: input.maturityDate,
          currency: input.currency,
          linkedAccountId: input.linkedAccountId || undefined,
        },
      });
      await fundPurchase(
        tx,
        session.userId,
        `DEPOSIT:${d.id}`,
        { cost: input.principal, currency: input.currency, date: input.startDate, label: `${input.bank} fixed deposit` },
        fundingFrom(input)
      );
      await settleRequest(tx, session.userId, input.idempotencyKey, d.id);
      return d;
    });
    return NextResponse.json({ deposit }, { status: 201 });
  } catch (err) {
    const won = await lostRace(err, session.userId, input.idempotencyKey);
    if (won) return NextResponse.json({ duplicate: true, id: won.resultId }, { status: 200 });
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
