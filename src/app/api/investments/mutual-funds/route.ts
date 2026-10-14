import { db } from "@/lib/db";
import { fundPurchase, fundingFrom, priceWithCharges } from "@/lib/investment-funding";
import { claimRequest, lostRace, requestSeen, settleRequest } from "@/lib/request-keys";
import { roundMoney } from "@/lib/validate";
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
  const replay = await requestSeen(userId, input.idempotencyKey);
  if (replay) return Response.json({ duplicate: true, lotId: replay.resultId }, { status: 200 });
  // Charges become part of each unit's cost.
  const nav = priceWithCharges(input.units, input.avgNav, input.charges);
  const total = roundMoney(input.units * input.avgNav + (input.charges ?? 0));
  const existing = await db.mutualFundHolding.findFirst({
    where: {
      userId,
      currency: input.currency,
      ...(input.schemeCode ? { schemeCode: input.schemeCode } : { fundName: { equals: input.fundName, mode: "insensitive" } }),
    },
  });
  // Best effort: an unreachable NAV feed shouldn't block adding the holding.
  const initialNav = !existing && input.schemeCode ? await fetchMutualFundNav(input.schemeCode) : null;
  const funding = fundingFrom(input);
  let holding;
  try {
  holding = await db.$transaction(async (tx: Tx) => {
    await claimRequest(tx, userId, input.idempotencyKey, "FUND_PURCHASE");
    const holdingId =
      existing?.id ??
      (
        await tx.mutualFundHolding.create({
          data: {
            userId,
            fundName: input.fundName,
            schemeCode: input.schemeCode,
            units: input.units,
            avgNav: nav,
            currency: input.currency,
            purchaseDate: input.purchaseDate,
            lastNav: initialNav,
            lastNavAt: initialNav != null ? new Date() : null,
          },
        })
      ).id;
    const lot = await tx.mutualFundLot.create({ data: { holdingId, units: input.units, nav, purchaseDate: input.purchaseDate } });
    await fundPurchase(tx, userId, `FUND_LOT:${lot.id}`, { cost: total, currency: input.currency, date: input.purchaseDate, label: input.fundName }, funding);
    await settleRequest(tx, userId, input.idempotencyKey, lot.id);
    await recomputeFundFromLots(holdingId, tx);
    return tx.mutualFundHolding.findUnique({ where: { id: holdingId }, include: { lots: true } });
  });
  } catch (err) {
    const won = await lostRace(err, userId, input.idempotencyKey);
    if (won) return Response.json({ duplicate: true, lotId: won.resultId }, { status: 200 });
    throw err;
  }
  return Response.json({ holding, merged: !!existing }, { status: 201 });
});
