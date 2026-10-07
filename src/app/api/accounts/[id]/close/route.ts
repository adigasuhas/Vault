import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { closeAccount } from "@/lib/ledger";
import { parseJson, ValidationError } from "@/lib/validate";
import { closeAccountSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Closes an account. With a balance, the client must either name an account
 * to move it to, or ask for a write-off and re-type the account's name. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const account = await db.account.findFirst({ where: { id: params.id, userId } });
  if (!account) return notFound("Account not found.");
  const input = await parseJson(req, closeAccountSchema);
  const hasBalance = Math.abs(Number(account.currentBalance)) >= 0.005;
  if (hasBalance && !input.transferToAccountId) {
    if (!input.writeOff) throw new ValidationError("Choose where the remaining balance goes, or confirm a write-off.");
    if ((input.confirmName ?? "").trim() !== account.name.trim()) {
      throw new ValidationError(`Type the account name exactly ("${account.name}") to confirm the write-off.`);
    }
  }
  const closed = await closeAccount(userId, account.id, {
    transferToAccountId: input.transferToAccountId,
    writeOff: input.writeOff,
    note: input.note,
  });
  return { account: closed };
});
