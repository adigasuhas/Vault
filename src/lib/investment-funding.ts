import { Prisma } from "@prisma/client";
import { ValidationError, roundMoney } from "@/lib/validate";
import { audit, postInvestmentPurchase, reverseInvestmentPurchase, type Tx } from "@/lib/ledger";
import { proceedsLeft, type Reinvestment } from "@/lib/investment-sales";
import { dateOnly } from "@/lib/dates";

/**
 * How an investment purchase was paid for. Without any of these the purchase
 * is only tracked (as before). Paid from an account, an INVESTMENT_PURCHASE
 * entry takes the money out of it — and, with a budget category, counts in
 * that month's budget. Paid from a sale's kept proceeds, it's recorded as a
 * reinvestment of that sale and no account changes.
 *
 * Each funded purchase has a `ref` ("STOCK_LOT:<id>", "FUND_LOT:<id>",
 * "DEPOSIT:<id>", "ASSET:<id>") so deleting or editing it can find what paid.
 */
export interface Funding {
  paidFromAccountId?: string | null;
  budgetCategoryId?: string | null;
  fromSaleId?: string | null;
  /** In the account's currency, when it differs from the investment's. */
  paidAmount?: number | null;
}

export interface Purchase {
  /** In the investment's currency. */
  cost: number;
  currency: string;
  date: Date;
  label: string;
}

type ReinvestmentWithRef = Reinvestment & { ref?: string };

export async function fundPurchase(tx: Tx, userId: string, ref: string, p: Purchase, f: Funding = {}) {
  if (f.paidFromAccountId && f.fromSaleId) throw new ValidationError("Choose one way it was paid: an account or a sale's proceeds.");
  const cost = roundMoney(p.cost);
  if (f.fromSaleId) {
    const sale = await tx.investmentSale.findFirst({ where: { id: f.fromSaleId, userId } });
    if (!sale) throw new ValidationError("Sale not found.");
    if (sale.currency !== p.currency) throw new ValidationError(`That sale's proceeds are in ${sale.currency}; this is in ${p.currency}.`);
    const left = proceedsLeft(sale);
    if (cost > left + 0.004) throw new ValidationError(`Only ${left.toFixed(2)} ${sale.currency} of that sale is waiting to be reinvested.`);
    const list: ReinvestmentWithRef[] = [
      ...((sale.reinvestments as unknown as ReinvestmentWithRef[]) ?? []),
      { amount: cost, into: p.label, date: dateOnly(p.date).toISOString(), note: null, ref },
    ];
    await tx.investmentSale.update({ where: { id: sale.id }, data: { reinvestments: list as unknown as Prisma.InputJsonValue } });
    await audit(tx, userId, "InvestmentSale", sale.id, "REINVEST", `${cost} ${sale.currency} of the ${sale.name} sale reinvested in ${p.label}`);
    return;
  }
  if (f.paidFromAccountId) {
    const account = await tx.account.findFirst({ where: { id: f.paidFromAccountId, userId } });
    if (!account) throw new ValidationError("Account not found.");
    let amount = cost;
    if (account.currency !== p.currency) {
      if (!f.paidAmount) throw new ValidationError(`${account.name} is in ${account.currency}. Enter the ${account.currency} amount that left it.`);
      amount = roundMoney(f.paidAmount);
    }
    await postInvestmentPurchase(tx, userId, {
      ref,
      accountId: account.id,
      amount,
      currency: account.currency,
      date: dateOnly(p.date),
      description: `Bought ${p.label}`,
      categoryId: f.budgetCategoryId ?? null,
    });
  }
}

/** Whether anything paid for this purchase (an account or a sale's proceeds). */
async function isFunded(tx: Tx, userId: string, ref: string) {
  const [paid, reinvested] = await Promise.all([
    tx.ledgerEntry.count({ where: { userId, investmentRef: ref, type: "INVESTMENT_PURCHASE", reversedAt: null } }),
    tx.investmentSale.count({ where: { userId, reinvestments: { array_contains: [{ ref }] } } }),
  ]);
  return paid + reinvested > 0;
}

/** A paid-for purchase that a sale has drawn on can't be undone or re-priced:
 * giving its cost back while the sale's proceeds stand would create money.
 * The sale has to be undone first. */
async function assertNotSold(tx: Tx, userId: string, ref: string) {
  const [kind, id] = ref.split(":");
  if (kind !== "STOCK_LOT" && kind !== "FUND_LOT") return;
  const sold = await tx.investmentSale.findFirst({ where: { userId, reversedAt: null, lots: { array_contains: [{ lotId: id }] } }, select: { name: true, soldOn: true } });
  if (sold) {
    throw new ValidationError(
      `Part of this purchase was sold on ${dateOnly(sold.soldOn).toISOString().slice(0, 10)}. Undo that sale under Sold & closed first, so its proceeds and this purchase's cost stay in balance.`
    );
  }
}

/** The purchase was deleted (a mistake): money it took from an account goes
 * back, and proceeds it used are waiting to be reinvested again. */
export async function unfundPurchase(tx: Tx, userId: string, ref: string, label: string) {
  if (!(await isFunded(tx, userId, ref))) return;
  await assertNotSold(tx, userId, ref);
  await reverseInvestmentPurchase(tx, userId, ref, `${label} removed`);
  const sales = await tx.investmentSale.findMany({ where: { userId, reinvestments: { array_contains: [{ ref }] } } });
  for (const sale of sales) {
    const list = ((sale.reinvestments as unknown as ReinvestmentWithRef[]) ?? []).filter((r) => r.ref !== ref);
    await tx.investmentSale.update({ where: { id: sale.id }, data: { reinvestments: list as unknown as Prisma.InputJsonValue } });
  }
}

/** The purchase's cost changed: re-book what paid for it at the new cost. */
export async function refundPurchase(tx: Tx, userId: string, ref: string, p: Purchase) {
  if (!(await isFunded(tx, userId, ref))) return;
  await assertNotSold(tx, userId, ref);
  const paid = await tx.ledgerEntry.findFirst({ where: { userId, investmentRef: ref, type: "INVESTMENT_PURCHASE", reversedAt: null }, include: { account: true } });
  if (paid) {
    if (paid.account && paid.account.currency !== p.currency) {
      throw new ValidationError(`It was paid from ${paid.account.name} in ${paid.account.currency}. Delete the purchase and add it again with the amount that left the account.`);
    }
    await reverseInvestmentPurchase(tx, userId, ref, `${p.label} corrected`);
    await postInvestmentPurchase(tx, userId, {
      ref,
      accountId: paid.accountId!,
      amount: roundMoney(p.cost),
      currency: paid.currency,
      date: dateOnly(p.date),
      description: `Bought ${p.label}`,
      categoryId: paid.categoryId,
    });
    return;
  }
  const sales = await tx.investmentSale.findMany({ where: { userId, reinvestments: { array_contains: [{ ref }] } } });
  for (const sale of sales) {
    const list = ((sale.reinvestments as unknown as ReinvestmentWithRef[]) ?? []).map((r) => (r.ref === ref ? { ...r, amount: roundMoney(p.cost), date: dateOnly(p.date).toISOString() } : r));
    const used = list.reduce((t, r) => t + Number(r.amount), 0);
    if (used > Number(sale.netProceeds) - Number(sale.creditedNet ?? 0) + 0.004) {
      throw new ValidationError(`That's more than the ${sale.name} sale's proceeds can cover.`);
    }
    await tx.investmentSale.update({ where: { id: sale.id }, data: { reinvestments: list as unknown as Prisma.InputJsonValue } });
  }
}
