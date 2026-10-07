import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { recordExpense } from "@/lib/ledger";
import { parseJson, ValidationError } from "@/lib/validate";
import { createExpenseSchema } from "@/lib/schemas";
import { monthRange } from "@/lib/dates";
import { payNextLoanEmi, userToday } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** `?month=YYYY-MM` (default: all, newest 300), `?categoryId`, `?accountId`,
 * `?kind=monthly|one_time`, `?projectId`, `?includeVoided=1` to also list
 * removed expenses (shown struck through). */
export const GET = authed(async (req, { userId }) => {
  const sp = req.nextUrl.searchParams;
  const month = sp.get("month");
  const range = month && /^\d{4}-\d{2}$/.test(month) ? monthRange(month) : null;
  const expenses = await db.expense.findMany({
    where: {
      userId,
      ...(sp.get("categoryId") ? { categoryId: sp.get("categoryId")! } : {}),
      ...(sp.get("accountId") ? { accountId: sp.get("accountId")! } : {}),
      ...(sp.get("projectId") ? { projectId: sp.get("projectId")! } : {}),
      ...(sp.get("kind") === "one_time" ? { oneTime: true } : sp.get("kind") === "monthly" ? { oneTime: false } : {}),
      ...(sp.get("includeVoided") === "1" ? {} : { voidedAt: null }),
      ...(range ? { date: { gte: range.start, lt: range.end } } : {}),
    },
    include: {
      category: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, currency: true, status: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: range ? 1000 : 300,
  });
  return { expenses };
});

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createExpenseSchema);
  if (input.oneTime) throw new ValidationError("One-time purchases now go in the Notebook, which keeps them out of your balances and monthly outflow.");
  if (!input.accountId) throw new ValidationError("Choose the account this was paid from.");
  const [account, category] = await Promise.all([
    input.accountId ? db.account.findFirst({ where: { id: input.accountId, userId } }) : null,
    db.category.findFirst({ where: { id: input.categoryId, userId } }),
  ]);
  if (input.accountId && !account) throw new ValidationError("Account not found.");
  if (!category) throw new ValidationError("Category not found.");
  if (input.projectId && !(await db.expenseProject.findFirst({ where: { id: input.projectId, userId } }))) {
    throw new ValidationError("Group not found.");
  }
  if (account && input.currency && input.currency !== account.currency) {
    throw new ValidationError(`${account.name} is in ${account.currency}. Log the expense against an account in ${input.currency}, or convert the amount.`);
  }
  // A loan's category means this is the loan's EMI: book it against the loan
  // (and its schedule) so Loans & EMIs shows it paid — not as a loose expense
  // the EMI schedule would then ask for again.
  const loan = await db.loan.findFirst({ where: { categoryId: category.id, userId }, select: { id: true, name: true } });
  if (loan) {
    if (!account) throw new ValidationError(`Choose the account the ${loan.name} EMI was paid from.`);
    if (input.oneTime) throw new ValidationError(`${loan.name} EMIs can't be one-time purchases. Untick "one-time" to log the EMI.`);
    const r = await payNextLoanEmi(userId, {
      loanId: loan.id,
      amount: input.amount,
      date: input.date ?? (await userToday(userId)),
      accountId: account.id,
      idempotencyKey: input.idempotencyKey,
    });
    return Response.json(
      { expense: null, duplicate: r.duplicate, loanEmi: { loanId: loan.id, loanName: loan.name, paidCount: r.paidCount ?? null } },
      { status: r.duplicate ? 200 : 201 }
    );
  }
  // Without an account, the purchase is in the currency given (or the user's main one).
  const currency =
    account?.currency ?? input.currency ?? (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } })).baseCurrency;
  const { expense, duplicate } = await recordExpense(userId, {
    accountId: account?.id ?? null,
    categoryId: category.id,
    amount: input.amount,
    currency,
    date: input.date ?? (await userToday(userId)),
    description: input.description,
    notes: input.notes,
    receiptUrl: input.receiptUrl,
    idempotencyKey: input.idempotencyKey,
    oneTime: input.oneTime,
    countInBudget: input.countInBudget,
    projectId: input.projectId,
  });
  return Response.json({ expense, duplicate }, { status: duplicate ? 200 : 201 });
});
