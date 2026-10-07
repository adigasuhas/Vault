import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { recordTransfer } from "@/lib/ledger";
import { parseJson, ValidationError } from "@/lib/validate";
import { createTransferSchema } from "@/lib/schemas";
import { userToday } from "@/lib/schedules";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => {
  const transfers = await db.transfer.findMany({
    where: { userId },
    include: {
      fromAccount: { select: { id: true, name: true, currency: true, status: true } },
      toAccount: { select: { id: true, name: true, currency: true, status: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return { transfers };
});

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createTransferSchema);
  const today = await userToday(userId);
  // A transfer records money that has moved; future moves are schedules.
  if (input.date && input.date > today) throw new ValidationError("A transfer can't be dated in the future.");
  const { transfer, duplicate } = await recordTransfer(userId, {
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amount: input.amount,
    toAmount: input.toAmount,
    date: input.date ?? today,
    notes: input.notes,
    idempotencyKey: input.idempotencyKey,
    confirmDuplicate: input.confirmDuplicate,
  });
  return Response.json({ transfer, duplicate }, { status: duplicate ? 200 : 201 });
});
