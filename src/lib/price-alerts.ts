import { db } from "@/lib/db";
import { sendPriceAlertEmail } from "@/lib/email";

/**
 * Stock price targets and stop-losses. They only inform: a stop-loss alert is
 * a warning to review the position, never a sell order.
 *
 * Prices come from the same quotes the rest of VAULT uses (Yahoo Finance),
 * refreshed by the scheduled market update, by "Refresh prices", and while
 * the Investments page is open. Alerts are checked right after each refresh,
 * so they are as timely as those updates and no more: this is not continuous
 * monitoring.
 *
 * Each threshold fires once when the price reaches it (target: at or above;
 * stop-loss: at or below). It fires again only after it re-arms: when the
 * price moves back past the threshold by REARM (a new crossing), or when the
 * user changes the threshold.
 */

import { STALE_AFTER_MS } from "@/lib/price-freshness";
export { STALE_AFTER_MS };
/** How far back past a threshold the price must move before it can fire again. */
export const REARM = 0.01;

export interface AlertState {
  targetPrice: number | null;
  stopLossPrice: number | null;
  targetArmed: boolean;
  stopArmed: boolean;
}

/** One check of a threshold pair against a price. Pure, so it is unit-tested. */
export function stepAlert(s: AlertState, price: number) {
  let { targetArmed, stopArmed } = s;
  let fireTarget = false;
  let fireStop = false;
  if (s.targetPrice != null && s.targetPrice > 0) {
    if (targetArmed && price >= s.targetPrice) {
      fireTarget = true;
      targetArmed = false;
    } else if (!targetArmed && price < s.targetPrice * (1 - REARM)) targetArmed = true;
  }
  if (s.stopLossPrice != null && s.stopLossPrice > 0) {
    if (stopArmed && price <= s.stopLossPrice) {
      fireStop = true;
      stopArmed = false;
    } else if (!stopArmed && price > s.stopLossPrice * (1 + REARM)) stopArmed = true;
  }
  return { fireTarget, fireStop, targetArmed, stopArmed };
}

/** Whether a quote can be used to decide that a threshold was reached. */
export function usableQuote(price: number | null | undefined, at: Date | null | undefined, now = Date.now()) {
  if (price == null || !Number.isFinite(price) || price <= 0 || !at) return false;
  return now - at.getTime() <= STALE_AFTER_MS;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Checks every alert on the given stocks (or all of a user's, or everyone's)
 * against their latest quotes, records a notification for each threshold
 * reached, and updates the re-arm state. Safe to run as often as prices
 * refresh: a threshold that already fired stays quiet until it re-arms.
 */
export async function checkPriceAlerts(scope: { userId?: string; stockHoldingIds?: string[] } = {}) {
  const alerts = await db.stockPriceAlert.findMany({
    where: {
      ...(scope.userId ? { userId: scope.userId } : {}),
      ...(scope.stockHoldingIds ? { stockHoldingId: { in: scope.stockHoldingIds } } : {}),
      OR: [{ targetPrice: { not: null } }, { stopLossPrice: { not: null } }],
    },
    include: {
      stockHolding: { select: { id: true, ticker: true, exchange: true, currency: true, lastPrice: true, lastPriceAt: true } },
      category: { select: { name: true } },
    },
  });
  const lotIds = alerts.map((a) => a.lotId).filter((x): x is string => !!x);
  const lots = lotIds.length
    ? await db.stockPurchaseLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, quantity: true, purchaseDate: true } })
    : [];
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const lotCats = lotIds.length
    ? await db.stockLotCategoryLink.findMany({ where: { lotId: { in: lotIds } }, select: { lotId: true, category: { select: { name: true } } } })
    : [];

  let fired = 0;
  const now = Date.now();
  for (const a of alerts) {
    const h = a.stockHolding;
    const price = h.lastPrice != null ? Number(h.lastPrice) : null;
    // No quote, or an old one: say nothing rather than claim a threshold was reached.
    if (!usableQuote(price, h.lastPriceAt, now)) continue;
    // A purchase a sale has since used up isn't held any more.
    if (a.lotId && !lotById.has(a.lotId)) continue;
    const step = stepAlert(
      { targetPrice: a.targetPrice != null ? Number(a.targetPrice) : null, stopLossPrice: a.stopLossPrice != null ? Number(a.stopLossPrice) : null, targetArmed: a.targetArmed, stopArmed: a.stopArmed },
      price!
    );
    if (step.targetArmed === a.targetArmed && step.stopArmed === a.stopArmed) continue;

    let scopeLabel: string | null = a.category?.name ?? null;
    if (a.lotId) {
      const lot = lotById.get(a.lotId)!;
      const names = lotCats.filter((c) => c.lotId === a.lotId).map((c) => c.category.name);
      scopeLabel = `${names.length ? `${names.join(", ")} · ` : ""}purchase of ${Number(lot.quantity)} on ${day(lot.purchaseDate)}`;
    }
    const events = [
      ...(step.fireTarget ? [{ kind: "TARGET" as const, threshold: Number(a.targetPrice) }] : []),
      ...(step.fireStop ? [{ kind: "STOP_LOSS" as const, threshold: Number(a.stopLossPrice) }] : []),
    ];
    // Claims the state change first, so two overlapping checks can't both notify.
    const claimed = await db.stockPriceAlert.updateMany({
      where: { id: a.id, targetArmed: a.targetArmed, stopArmed: a.stopArmed },
      data: { targetArmed: step.targetArmed, stopArmed: step.stopArmed },
    });
    if (!claimed.count) continue;
    for (const e of events) {
      await db.priceAlertEvent.create({
        data: {
          userId: a.userId,
          alertId: a.id,
          stockHoldingId: h.id,
          kind: e.kind,
          ticker: h.ticker,
          exchange: h.exchange,
          scopeLabel,
          threshold: e.threshold,
          observedPrice: price!,
          currency: h.currency,
          priceAt: h.lastPriceAt!,
        },
      });
      fired++;
      try {
        const user = await db.user.findUnique({ where: { id: a.userId }, select: { email: true, name: true, setting: { select: { notifyPriceAlerts: true } } } });
        if (user && user.setting?.notifyPriceAlerts !== false) {
          await sendPriceAlertEmail(user.email, user.name, { kind: e.kind, ticker: h.ticker, scopeLabel, threshold: e.threshold, price: price!, currency: h.currency, priceAt: h.lastPriceAt! });
        }
      } catch (err) {
        console.error("price alert email failed", err);
      }
    }
  }
  return { checked: alerts.length, fired };
}

export interface AlertInput {
  /** Whole stock, one category's shares (a client), or one purchase. */
  scope: "STOCK" | "CATEGORY" | "LOT";
  categoryId?: string | null;
  lotId?: string | null;
  /** Per share, in the stock's currency. null removes it. */
  targetPrice?: number | null;
  stopLossPrice?: number | null;
}

const scopeKey = (a: { categoryId?: string | null; lotId?: string | null }) => `${a.categoryId ?? ""}|${a.lotId ?? ""}`;
const round4 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 1e4) / 1e4);

/**
 * Replaces a stock's alerts with `list` (inside the caller's transaction).
 * An alert whose threshold changes is armed again; an unchanged one keeps
 * its state, so re-saving the form never re-sends a notification.
 */
export async function setStockAlerts(tx: import("@/lib/ledger").Tx, userId: string, stockHoldingId: string, list: AlertInput[]) {
  const { ValidationError } = await import("@/lib/validate");
  const holding = await tx.stockHolding.findFirst({ where: { id: stockHoldingId, userId }, include: { lots: { select: { id: true } } } });
  if (!holding) throw new ValidationError("Stock not found.");
  const wanted = new Map<string, { categoryId: string | null; lotId: string | null; targetPrice: number | null; stopLossPrice: number | null }>();
  for (const a of list) {
    const categoryId = a.scope === "CATEGORY" ? a.categoryId ?? null : null;
    const lotId = a.scope === "LOT" ? a.lotId ?? null : null;
    if (a.scope === "CATEGORY" && !categoryId) throw new ValidationError("Choose the category this alert is for.");
    if (a.scope === "LOT" && !lotId) throw new ValidationError("Choose the purchase this alert is for.");
    if (categoryId && !(await tx.investmentCategory.findFirst({ where: { id: categoryId, userId }, select: { id: true } }))) throw new ValidationError("That category doesn't exist.");
    if (lotId && !holding.lots.some((l) => l.id === lotId)) throw new ValidationError("That purchase isn't part of this stock.");
    const targetPrice = round4(a.targetPrice);
    const stopLossPrice = round4(a.stopLossPrice);
    if ((targetPrice != null && !(targetPrice > 0)) || (stopLossPrice != null && !(stopLossPrice > 0))) throw new ValidationError("Prices must be above zero.");
    if (targetPrice != null && stopLossPrice != null && stopLossPrice >= targetPrice) throw new ValidationError("The stop-loss has to be below the target.");
    const key = scopeKey({ categoryId, lotId });
    if (wanted.has(key)) throw new ValidationError("There are two alerts for the same shares. Combine them into one.");
    if (targetPrice == null && stopLossPrice == null) continue; // both cleared: remove it
    wanted.set(key, { categoryId, lotId, targetPrice, stopLossPrice });
  }
  const existing = await tx.stockPriceAlert.findMany({ where: { stockHoldingId, userId } });
  for (const e of existing) {
    const w = wanted.get(scopeKey(e));
    if (!w) {
      await tx.stockPriceAlert.delete({ where: { id: e.id } });
      continue;
    }
    const oldT = e.targetPrice != null ? Number(e.targetPrice) : null;
    const oldS = e.stopLossPrice != null ? Number(e.stopLossPrice) : null;
    await tx.stockPriceAlert.update({
      where: { id: e.id },
      data: {
        targetPrice: w.targetPrice,
        stopLossPrice: w.stopLossPrice,
        ...(oldT !== w.targetPrice ? { targetArmed: true } : {}),
        ...(oldS !== w.stopLossPrice ? { stopArmed: true } : {}),
      },
    });
    wanted.delete(scopeKey(e));
  }
  for (const w of wanted.values()) await tx.stockPriceAlert.create({ data: { userId, stockHoldingId, ...w } });
}
