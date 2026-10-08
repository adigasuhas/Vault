import { db } from "@/lib/db";
import { fundPurchase } from "@/lib/investment-funding";
import type { Tx } from "@/lib/ledger";
import { authed } from "@/lib/api";
import { fetchMutualFundNav } from "@/lib/market-data";
import { parseJson } from "@/lib/validate";
import { createFundSchema } from "@/lib/schemas";
import { recomputeFundFromLots } from "@/lib/funds";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => {
  const holdings = await db.mutualFundHolding.findMany({
    where: { userId },
    include: { lots: { orderBy: { purchaseDate: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return { holdings };
});

/** Adds a purchase. Buying a fund you already hold (same scheme code, or the
 * same name when there's no code, in the same currency) adds a purchase to
 * that holding instead of creating a duplicate row. */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createFundSchema);
  const existing = await db.mutualFundHolding.findFirst({
    where: {
      userId,
      currency: input.currency,
      ...(input.schemeCode ? { schemeCode: input.schemeCode } : { fundName: { equals: input.fundName, mode: "insensitive" } }),
    },
  });
  // Best effort: an unreachable NAV feed shouldn't block adding the holding.
  const initialNav = !existing && input.schemeCode ? await fetchMutualFundNav(input.schemeCode) : null;
  const funding = { paidFromAccountId: input.paidFromAccountId, budgetCategoryId: input.budgetCategoryId, fromSaleId: input.fromSaleId, paidAmount: input.paidAmount };
  const holding = await db.$transaction(async (tx: Tx) => {
    const holdingId =
      existing?.id ??
      (
        await tx.mutualFundHolding.create({
          data: {
            userId,
            fundName: input.fundName,
            schemeCode: input.schemeCode,
            units: input.units,
            avgNav: input.avgNav,
            currency: input.currency,
            purchaseDate: input.purchaseDate,
            lastNav: initialNav,
            lastNavAt: initialNav != null ? new Date() : null,
          },
        })
      ).id;
    const lot = await tx.mutualFundLot.create({ data: { holdingId, units: input.units, nav: input.avgNav, purchaseDate: input.purchaseDate } });
    await fundPurchase(tx, userId, `FUND_LOT:${lot.id}`, { cost: input.units * input.avgNav, currency: input.currency, date: input.purchaseDate, label: input.fundName }, funding);
    await recomputeFundFromLots(holdingId, tx);
    return tx.mutualFundHolding.findUnique({ where: { id: holdingId }, include: { lots: true } });
  });
  return Response.json({ holding, merged: !!existing }, { status: 201 });
});
