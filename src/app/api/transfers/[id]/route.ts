import { authed } from "@/lib/api";
import { reverseTransfer } from "@/lib/ledger";
import { parseJson } from "@/lib/validate";
import { reverseSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Reverses a transfer with compensating ledger entries on both accounts.
 * The transfer and its original entries stay on record. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, reverseSchema).catch(() => ({ reason: undefined }));
  const transfer = await reverseTransfer(userId, params.id, input.reason);
  return { transfer };
});
