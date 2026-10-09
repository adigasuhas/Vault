import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Full export of the signed-in user's own data as a single JSON document
 * (DPDP Act 2023 / GDPR data-portability, finding R6). Nothing sensitive to
 * other users, and no password hash.
 */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const userId = session.userId;

  const [
    user,
    accounts,
    ledgerEntries,
    categories,
    expenses,
    transfers,
    scheduledCredits,
    creditExecutions,
    budgetPlans,
    stockHoldings,
    mutualFunds,
    fixedDeposits,
    otherAssets,
    exchangeRates,
    loans,
    monthlyPlans,
    setting,
    auditEvents,
    scheduleOverrides,
    loanPayments,
    expenseProjects,
    notebookEntries,
    investmentSales,
    investmentCategories,
  ] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId } }),
    db.ledgerEntry.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    db.category.findMany({ where: { userId } }),
    db.expense.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    db.transfer.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    db.scheduledCredit.findMany({ where: { userId } }),
    db.creditExecution.findMany({ where: { scheduledCredit: { userId } } }),
    db.budgetPlan.findMany({ where: { userId }, include: { allocations: { include: { adjustments: true } } } }),
    db.stockHolding.findMany({ where: { userId }, include: { lots: true } }),
    db.mutualFundHolding.findMany({ where: { userId }, include: { lots: true } }),
    db.fixedDeposit.findMany({ where: { userId } }),
    db.otherAsset.findMany({ where: { userId } }),
    db.exchangeRate.findMany({ where: { userId } }),
    db.loan.findMany({ where: { userId } }),
    db.monthlyPlan.findMany({ where: { userId } }),
    db.setting.findUnique({ where: { userId } }),
    db.auditEvent.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.scheduleOverride.findMany({ where: { scheduledCredit: { userId } } }),
    db.loanPayment.findMany({ where: { loan: { userId } } }),
    db.expenseProject.findMany({ where: { userId } }),
    db.notebookEntry.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    db.investmentSale.findMany({ where: { userId }, orderBy: { soldOn: "asc" } }),
    db.investmentCategory.findMany({ where: { userId }, include: { links: { select: { kind: true, holdingId: true } }, lotLinks: { select: { lotId: true } } }, orderBy: { name: "asc" } }),
  ]);

  const profile = user
    ? {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        timezone: user.timezone,
        baseCurrency: user.baseCurrency,
        exchangeRateMode: user.exchangeRateMode,
        isOnboarded: user.isOnboarded,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
      }
    : null;

  const payload = {
    exportedAt: new Date().toISOString(),
    format: "vault-export/v2",
    profile,
    accounts,
    ledgerEntries,
    categories,
    expenses,
    expenseProjects,
    notebookEntries,
    transfers,
    scheduledCredits,
    creditExecutions,
    budgetPlans,
    stockHoldings,
    mutualFunds,
    fixedDeposits,
    otherAssets,
    investmentSales,
    investmentCategories,
    exchangeRates,
    loans,
    monthlyPlans,
    setting,
    auditEvents,
    scheduleOverrides,
    loanPayments,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="vault-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
