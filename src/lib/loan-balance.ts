import { db } from "@/lib/db";
import type { FxConverter } from "@/lib/fx";

export interface LoanLiability {
  id: string;
  name: string;
  currency: string;
  outstanding: number;
  base: number;
}

/**
 * Outstanding principal on the user's active loans, in their own currency and
 * converted to base. This is debt the ledger doesn't carry (a loan isn't an
 * account), so net worth must subtract it explicitly.
 *
 * With `asOf`, only loans started by then and payments made by then (and not
 * reversed by then) count, for reconstructing past months.
 */
export async function loanLiabilities(userId: string, fx: FxConverter, asOf?: Date) {
  const loans = await db.loan.findMany({
    where: { userId, status: "ACTIVE", ...(asOf ? { startDate: { lte: asOf } } : {}) },
    select: {
      id: true,
      name: true,
      currency: true,
      principal: true,
      payments: { select: { principalComponent: true, paidOn: true, reversedAt: true } },
    },
  });

  const rows: LoanLiability[] = loans.map((l) => {
    const counted = l.payments.filter((p) =>
      asOf ? p.paidOn <= asOf && (!p.reversedAt || p.reversedAt > asOf) : !p.reversedAt
    );
    const principalCents = Math.round(Number(l.principal) * 100);
    const paidCents = counted.reduce((s, p) => s + Math.round(Number(p.principalComponent) * 100), 0);
    const outstanding = Math.max(0, principalCents - paidCents) / 100;
    return { id: l.id, name: l.name, currency: l.currency, outstanding, base: fx.convert(outstanding, l.currency) };
  });

  return { loans: rows, total: rows.reduce((s, r) => s + r.base, 0) };
}
