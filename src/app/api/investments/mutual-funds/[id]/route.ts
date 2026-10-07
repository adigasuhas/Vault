import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { patchFundSchema } from "@/lib/schemas";
import { recomputeFundFromLots } from "@/lib/funds";

export const dynamic = "force-dynamic";

/** Scheme code can always change; units/NAV only on a single-purchase fund
 * (otherwise edit the individual purchase). */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const existing = await db.mutualFundHolding.findFirst({ where: { id: params.id, userId }, include: { lots: true } });
  if (!existing) return notFound("Fund not found.");
  const input = await parseJson(req, patchFundSchema);
  if ((input.units !== undefined || input.avgNav !== undefined) && existing.lots.length > 1) {
    throw new ValidationError("This fund is made of several purchases. Open its details and edit the purchase you want to fix.");
  }
  if (input.schemeCode !== undefined) await db.mutualFundHolding.update({ where: { id: existing.id }, data: { schemeCode: input.schemeCode || null } });
  if ((input.units !== undefined || input.avgNav !== undefined) && existing.lots[0]) {
    await db.mutualFundLot.update({
      where: { id: existing.lots[0].id },
      data: { ...(input.units !== undefined ? { units: input.units } : {}), ...(input.avgNav !== undefined ? { nav: input.avgNav } : {}) },
    });
  }
  return { holding: await recomputeFundFromLots(existing.id) };
});

export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await db.mutualFundHolding.findFirst({ where: { id: params.id, userId } });
  if (!existing) return notFound("Fund not found.");
  await db.mutualFundHolding.delete({ where: { id: existing.id } });
  return { ok: true };
});
