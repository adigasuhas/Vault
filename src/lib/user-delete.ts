import { db } from "@/lib/db";
import type { Tx } from "@/lib/ledger";

/**
 * Permanently deletes a user and everything they own, in dependency order,
 * in one transaction. Relying on the User → * cascades alone fails: Postgres
 * checks the Category/Account foreign keys of budget lines, expenses and
 * transfers before the cascade has reached those rows. This is the only
 * place financial rows are ever hard-deleted — at the owner's explicit request
 * to erase their account.
 */
export async function deleteUserData(userId: string) {
  await db.$transaction(async (tx: Tx) => {
    await tx.ledgerEntry.updateMany({ where: { userId, reversalOfId: { not: null } }, data: { reversalOfId: null } });
    await tx.ledgerEntry.deleteMany({ where: { userId } });
    await tx.loanPayment.deleteMany({ where: { loan: { userId } } });
    await tx.scheduledCredit.deleteMany({ where: { userId } });
    await tx.expense.deleteMany({ where: { userId } });
    await tx.transfer.deleteMany({ where: { userId } });
    await tx.budgetPlan.deleteMany({ where: { userId } });
    await tx.loan.deleteMany({ where: { userId } });
    await tx.fixedDeposit.deleteMany({ where: { userId } });
    await tx.category.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  }, { timeout: 30_000 });
}
