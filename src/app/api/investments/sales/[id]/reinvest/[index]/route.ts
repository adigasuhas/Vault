import { authed } from "@/lib/api";
import { ValidationError } from "@/lib/validate";
import { removeReinvestment } from "@/lib/investment-sales";

export const dynamic = "force-dynamic";

/** Removes one reinvestment record; that amount is waiting to be reinvested again. */
export const DELETE = authed<{ id: string; index: string }>(async (_req, { userId, params }) => {
  const index = Number(params.index);
  if (!Number.isInteger(index) || index < 0) throw new ValidationError("Unknown reinvestment.");
  return { sale: await removeReinvestment(userId, params.id, index) };
});
