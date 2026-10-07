import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { loanAmortization, loanProgress, resolveLoanTerms } from "@/lib/loans";
import { parseJson, ValidationError } from "@/lib/validate";
import { createLoanSchema } from "@/lib/schemas";
import { audit, type Tx } from "@/lib/ledger";
import { createEmiSchedule, loanCategory } from "@/lib/loan-schedule";
import { markConverted } from "@/lib/notebook";
import { runDueSchedules, userToday } from "@/lib/schedules";
import { monthKey, dateOnly } from "@/lib/dates";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => {
  const loans = await db.loan.findMany({
    where: { userId },
    include: {
      linkedAccount: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      schedule: { select: { id: true, isActive: true, requiresConfirmation: true, nextExecutionDate: true } },
      payments: { where: { reversedAt: null }, select: { amount: true, principalComponent: true, interestComponent: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return {
    loans: loans.map(({ payments, ...loan }) => {
      const schedule = loanAmortization(loan);
      const progress = loanProgress(
        schedule,
        payments.map((p) => ({ principalComponent: Number(p.principalComponent), interestComponent: Number(p.interestComponent), amount: Number(p.amount) }))
      );
      return { ...loan, progress };
    }),
  };
});

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createLoanSchema);
  if (input.linkedAccountId) {
    const account = await db.account.findFirst({ where: { id: input.linkedAccountId, userId, status: { not: "CLOSED" } } });
    if (!account) throw new ValidationError("Linked account not found.");
    if (account.currency !== input.currency) throw new ValidationError(`The loan is in ${input.currency}; ${account.name} is in ${account.currency}.`);
  }
  if (input.scheduleEmis && !input.linkedAccountId) throw new ValidationError("Choose the account EMIs are paid from.");

  const start = dateOnly(input.startDate);
  const { emiAmount, installments, endDate } = resolveLoanTerms({ ...input, startDate: start });
  const month = monthKey(await userToday(userId));

  try {
    const loan = await db.$transaction(async (tx: Tx) => {
      const category = await loanCategory(tx, userId, input.name, {
        // Without an EMI schedule the category itself carries the EMI into
        // each month's budget (the pre-schedule behaviour).
        isDefault: !input.scheduleEmis,
        defaultAmount: input.scheduleEmis ? 0 : emiAmount,
        defaultSince: month,
      });
      const loan = await tx.loan.create({
        data: {
          userId,
          name: input.name,
          principal: input.principal,
          interestRate: input.interestRate,
          installments,
          emiAmount,
          currency: input.currency,
          startDate: start,
          endDate,
          linkedAccountId: input.linkedAccountId,
          categoryId: category.id,
        },
      });
      if (input.notebookEntryId) await markConverted(tx, userId, input.notebookEntryId, "LOAN", loan.id);
      if (input.scheduleEmis && input.linkedAccountId) {
        await createEmiSchedule(tx, userId, loan, { accountId: input.linkedAccountId, requiresConfirmation: input.requiresConfirmation ?? true });
      }
      await audit(tx, userId, "loan", loan.id, "loan.create", `Added loan ${loan.name}`, {
        principal: input.principal,
        rate: input.interestRate,
        installments,
        emi: emiAmount,
      });
      return loan;
    });
    await runDueSchedules(new Date(), userId);
    return Response.json({ loan }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError("You already have a loan (or category) with this name.");
    }
    throw err;
  }
});
