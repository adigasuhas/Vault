import { authed } from "@/lib/api";
import { undoSale } from "@/lib/investment-sales";

export const dynamic = "force-dynamic";

export const POST = authed<{ id: string }>(async (_req, { userId, params }) => {
  const sale = await undoSale(userId, params.id);
  return { sale };
});
