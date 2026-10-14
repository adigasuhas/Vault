import { ValidationError, roundMoney } from "@/lib/validate";
import { postInvestmentPurchase, reverseInvestmentPurchase, type Tx } from "@/lib/ledger";
import { postCash, reverseCash } from "@/lib/investment-cash";
import { dateOnly } from "@/lib/dates";

/**
 * How an investment purchase was paid for. Without any of these the purchase
 * is only tracked: no money moves. Otherwise its total (price plus charges)
 * is covered by investment cash, an account, or both:
 *
 *  - investment cash: a PURCHASE entry in investment cash (lib/investment-cash);
 *  - an account: an INVESTMENT_PURCHASE ledger entry, which counts in that
 *    month's budget when it has a category (never as spending in analytics).
 *
 * The two parts must add up to the total exactly; nothing is ever taken from
 * an account to cover a shortfall unless the user picked that account.
 *
 * Each funded purchase has a `ref` ("STOCK_LOT:<id>", "FUND_LOT:<id>",
 * "DEPOSIT:<id>", "ASSET:<id>") so deleting or editing it finds what paid.
 */
export interface Funding {
  paidFromAccountId?: string | null;
  budgetCategoryId?: string | null;
  /** In the account's currency, when it differs from the investment's: what
   * left the account for its part. */
  paidAmount?: number | null;
  /** How much of the total comes out of investment cash (investment's currency). */
  fromCash?: number | null;
}

export interface Purchase {
  /** Everything paid, charges included, in the investment's currency. */
  cost: number;
  currency: string;
  date: Date;
  label: string;
}

/** The funding fields of a create request. */
export function fundingFrom(input: { paidFromAccountId?: string; budgetCategoryId?: string; paidAmount?: number; fromCash?: number }): Funding {
  return { paidFromAccountId: input.paidFromAccountId, budgetCategoryId: input.budgetCategoryId, paidAmount: input.paidAmount, fromCash: input.fromCash };
}

/** Purchase charges spread over the units bought: what each one really cost.
 * Kept in the purchase price so cost basis, profit and averages include them. */
export function priceWithCharges(units: number, price: number, charges = 0) {
  return charges > 0 ? price + charges / units : price;
}

/** The split a funding choice makes of a purchase's total. */
export function fundingSplit(total: number, f: Funding) {
  const cost = roundMoney(total);
  const cash = roundMoney(f.fromCash ?? 0);
  if (cash < 0) throw new ValidationError("The investment cash amount can't be negative.");
  if (cash > cost + 0.004) throw new ValidationError(`That's more investment cash than the purchase needs (${cost.toFixed(2)}).`);
  const bank = roundMoney(cost - cash);
  if (bank > 0.004 && cash > 0 && !f.paidFromAccountId) {
    throw new ValidationError(`Investment cash covers ${cash.toFixed(2)} of ${cost.toFixed(2)}. Choose an account for the other ${bank.toFixed(2)}, or use more investment cash.`);
  }
  return { cash, bank: f.paidFromAccountId ? bank : 0, tracked: !f.paidFromAccountId && !(cash > 0) };
}

export async function fundPurchase(tx: Tx, userId: string, ref: string, p: Purchase, f: Funding = {}) {
  const { cash, bank } = fundingSplit(p.cost, f);
  // The account first, then investment cash: the same lock order as moves
  // between them, so concurrent requests can't deadlock.
  if (f.paidFromAccountId && bank > 0.004) {
    const account = await tx.account.findFirst({ where: { id: f.paidFromAccountId, userId } });
    if (!account) throw new ValidationError("Account not found.");
    let amount = bank;
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
  if (cash > 0) {
    await postCash(tx, userId, {
      currency: p.currency,
      type: "PURCHASE",
      amount: cash,
      date: p.date,
      description: `Bought ${p.label}`,
      investmentRef: ref,
      insufficient: (b) => `Investment cash has ${b.toFixed(2)} ${p.currency}, and this uses ${cash.toFixed(2)}. Use less of it and pay the rest from an account, or add money to investment cash first.`,
    });
  }
}

async function standing(tx: Tx, userId: string, ref: string) {
  const [paid, cash] = await Promise.all([
    tx.ledgerEntry.findMany({ where: { userId, investmentRef: ref, type: "INVESTMENT_PURCHASE", reversedAt: null }, include: { account: true } }),
    tx.investmentCashEntry.findMany({ where: { userId, investmentRef: ref, type: "PURCHASE", reversedAt: null } }),
  ]);
  return { paid, cash };
}

/** Whether anything paid for this purchase (an account or investment cash). */
export async function isFunded(tx: Tx, userId: string, ref: string) {
  const { paid, cash } = await standing(tx, userId, ref);
  return paid.length + cash.length > 0;
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
 * back there, and investment cash it used goes back to investment cash. */
export async function unfundPurchase(tx: Tx, userId: string, ref: string, label: string) {
  const { paid, cash } = await standing(tx, userId, ref);
  if (!paid.length && !cash.length) return;
  await assertNotSold(tx, userId, ref);
  if (paid.length) await reverseInvestmentPurchase(tx, userId, ref, `${label} removed`);
  for (const c of cash) await reverseCash(tx, userId, c.id, `${label} removed`);
}

/** The purchase's total or date changed: re-book what paid for it.
 * Investment cash keeps covering what it covered (up to the new total) and
 * the account covers the rest; a purchase paid only from investment cash
 * takes its new total from it. Editing never takes money from an account
 * that didn't pay, and an edit that changes nothing moves nothing. */
export async function refundPurchase(tx: Tx, userId: string, ref: string, p: Purchase) {
  const { paid, cash } = await standing(tx, userId, ref);
  if (!paid.length && !cash.length) return;
  const bankEntry = paid[0];
  const total = roundMoney(p.cost);
  const usedCash = roundMoney(cash.reduce((t, c) => t + Number(c.amount), 0));
  const usedBank = roundMoney(paid.reduce((t, e) => t + Number(e.amount), 0));
  const nextCash = bankEntry ? Math.min(usedCash, total) : total;
  const nextBank = roundMoney(total - nextCash);
  const day = dateOnly(p.date).getTime();
  const sameDay = [...paid, ...cash].every((e) => dateOnly(e.date).getTime() === day);
  if (sameDay && Math.abs(nextCash - usedCash) < 0.005 && (!bankEntry || Math.abs(nextBank - usedBank) < 0.005)) return;

  await assertNotSold(tx, userId, ref);
  if (bankEntry?.account && bankEntry.account.currency !== p.currency) {
    throw new ValidationError(`It was paid from ${bankEntry.account.name} in ${bankEntry.account.currency}. Delete the purchase and add it again with the amount that left the account.`);
  }
  if (paid.length) await reverseInvestmentPurchase(tx, userId, ref, `${p.label} corrected`);
  for (const c of cash) await reverseCash(tx, userId, c.id, `${p.label} corrected`);
  await fundPurchase(
    tx,
    userId,
    ref,
    p,
    bankEntry ? { paidFromAccountId: bankEntry.accountId, budgetCategoryId: bankEntry.categoryId, fromCash: nextCash } : { fromCash: nextCash }
  );
}
