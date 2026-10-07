import { db } from "@/lib/db";
import { Prisma, type InvestmentKind } from "@prisma/client";
import { ValidationError, roundMoney } from "@/lib/validate";
import { audit, postInvestmentSale, reverseInvestmentSale, type Tx } from "@/lib/ledger";
import { recomputeHoldingFromLots } from "@/lib/stocks";
import { recomputeFundFromLots } from "@/lib/funds";
import { dateOnly } from "@/lib/dates";
import { matchLotsFifo, EPS, r6, type SoldLot } from "@/lib/fifo";
import type { CreateSaleInput } from "@/lib/schemas";

/**
 * Selling investments.
 *
 * A sale shrinks a holding (or removes it when nothing is left), records an
 * InvestmentSale with the purchases it used up, and credits the net proceeds
 * to an account through an INVESTMENT_SALE ledger entry. Shares and fund
 * units are matched first in, first out: the oldest purchases are sold first.
 * Deposits and other assets are sold whole.
 *
 * Undoing a sale reverses the ledger entry and puts the purchases back, so the
 * history keeps both the sale and its undo.
 */

export type { SoldLot } from "@/lib/fifo";

/** Ahead of UTC (India, say), "today" is already tomorrow in UTC terms for
 * part of the day, so allow one day of slack. */
function assertNotFuture(soldOn: Date) {
  if (dateOnly(soldOn).getTime() > dateOnly(new Date()).getTime() + 86_400_000) {
    throw new ValidationError("The sale date can't be in the future.");
  }
}

function assertDate(soldOn: Date, from: Date, what: string) {
  if (dateOnly(soldOn) < dateOnly(from)) throw new ValidationError(`The sale date is before ${what}.`);
}

type Prepared = {
  kind: InvestmentKind;
  name: string;
  detail: string | null;
  currency: string;
  quantity: number | null;
  price: number | null;
  gross: number;
  cost: number;
  firstBoughtOn: Date;
  closedPosition: boolean;
  lots: SoldLot[];
  snapshot: Prisma.InputJsonValue;
  /** Shrinks or removes the holding. Runs after the sale row is written. */
  apply: (tx: Tx) => Promise<void>;
  label: string;
};

async function prepare(tx: Tx, userId: string, input: CreateSaleInput): Promise<Prepared> {
  switch (input.kind) {
    case "STOCK": {
      const h = await tx.stockHolding.findFirst({ where: { id: input.holdingId, userId }, include: { lots: true } });
      if (!h) throw new ValidationError("Holding not found.");
      const lots = h.lots.map((l) => ({ id: l.id, quantity: Number(l.quantity), price: Number(l.price), purchaseDate: l.purchaseDate }));
      const { used, remaining } = matchLotsFifo(lots, input.quantity, input.soldOn);
      const left = r6(lots.reduce((s, l) => s + l.quantity, 0) - input.quantity);
      return {
        kind: "STOCK",
        name: h.ticker,
        detail: h.exchange,
        currency: h.currency,
        quantity: input.quantity,
        price: input.price,
        gross: roundMoney(input.quantity * input.price),
        cost: roundMoney(used.reduce((s, l) => s + l.cost, 0)),
        firstBoughtOn: new Date(used[0].purchaseDate),
        closedPosition: left <= EPS,
        lots: used,
        snapshot: { ticker: h.ticker, exchange: h.exchange, currency: h.currency, lastPrice: h.lastPrice?.toString() ?? null, lastPriceAt: h.lastPriceAt?.toISOString() ?? null, previousClose: h.previousClose?.toString() ?? null },
        label: `Sold ${input.quantity} ${h.ticker}`,
        apply: async (t) => {
          for (const r of remaining) {
            if (r.quantity <= EPS) await t.stockPurchaseLot.delete({ where: { id: r.id } });
            else await t.stockPurchaseLot.update({ where: { id: r.id }, data: { quantity: r.quantity } });
          }
          await recomputeHoldingFromLots(h.id, t);
        },
      };
    }
    case "MUTUAL_FUND": {
      const f = await tx.mutualFundHolding.findFirst({ where: { id: input.holdingId, userId }, include: { lots: true } });
      if (!f) throw new ValidationError("Fund not found.");
      // A fund saved before purchases were tracked has no lots: treat its
      // aggregate as one purchase.
      const lots = f.lots.length
        ? f.lots.map((l) => ({ id: l.id, quantity: Number(l.units), price: Number(l.nav), purchaseDate: l.purchaseDate }))
        : [{ id: "", quantity: Number(f.units), price: Number(f.avgNav), purchaseDate: f.purchaseDate }];
      const { used, remaining } = matchLotsFifo(lots, input.quantity, input.soldOn);
      const left = r6(lots.reduce((s, l) => s + l.quantity, 0) - input.quantity);
      return {
        kind: "MUTUAL_FUND",
        name: f.fundName,
        detail: f.schemeCode,
        currency: f.currency,
        quantity: input.quantity,
        price: input.price,
        gross: roundMoney(input.quantity * input.price),
        cost: roundMoney(used.reduce((s, l) => s + l.cost, 0)),
        firstBoughtOn: new Date(used[0].purchaseDate),
        closedPosition: left <= EPS,
        lots: used.map((u) => ({ ...u, lotId: u.lotId || null })),
        snapshot: { fundName: f.fundName, schemeCode: f.schemeCode, currency: f.currency, lastNav: f.lastNav?.toString() ?? null, lastNavAt: f.lastNavAt?.toISOString() ?? null },
        label: `Redeemed ${input.quantity} units of ${f.fundName}`,
        apply: async (t) => {
          if (!f.lots.length) {
            // Turn the aggregate into a real purchase first, then sell from it.
            await t.mutualFundLot.create({ data: { holdingId: f.id, units: Number(f.units), nav: Number(f.avgNav), purchaseDate: f.purchaseDate } });
            if (left <= EPS) await t.mutualFundLot.deleteMany({ where: { holdingId: f.id } });
            else await t.mutualFundLot.updateMany({ where: { holdingId: f.id }, data: { units: left } });
          } else {
            for (const r of remaining) {
              if (r.quantity <= EPS) await t.mutualFundLot.delete({ where: { id: r.id } });
              else await t.mutualFundLot.update({ where: { id: r.id }, data: { units: r.quantity } });
            }
          }
          await recomputeFundFromLots(f.id, t);
        },
      };
    }
    case "FIXED_DEPOSIT": {
      const d = await tx.fixedDeposit.findFirst({ where: { id: input.holdingId, userId } });
      if (!d) throw new ValidationError("Deposit not found.");
      assertDate(input.soldOn, d.startDate, "the deposit started");
      const principal = Number(d.principal);
      return {
        kind: "FIXED_DEPOSIT",
        name: d.bank,
        detail: `${Number(d.interestRate)}% a year`,
        currency: d.currency,
        quantity: null,
        price: null,
        gross: input.amount,
        cost: principal,
        firstBoughtOn: d.startDate,
        closedPosition: true,
        lots: [{ lotId: null, purchaseDate: d.startDate.toISOString(), quantity: null, price: null, cost: principal }],
        snapshot: { bank: d.bank, principal: d.principal.toString(), interestRate: d.interestRate.toString(), startDate: d.startDate.toISOString(), maturityDate: d.maturityDate.toISOString(), currency: d.currency, linkedAccountId: d.linkedAccountId, prematureClosure: dateOnly(input.soldOn) < dateOnly(d.maturityDate) },
        label: `Closed ${d.bank} fixed deposit`,
        apply: async (t) => {
          await t.fixedDeposit.delete({ where: { id: d.id } });
        },
      };
    }
    case "OTHER": {
      const a = await tx.otherAsset.findFirst({ where: { id: input.holdingId, userId } });
      if (!a) throw new ValidationError("Asset not found.");
      assertDate(input.soldOn, a.purchaseDate, "it was bought");
      const cost = Number(a.purchasePrice);
      return {
        kind: "OTHER",
        name: a.name,
        detail: a.assetType,
        currency: a.currency,
        quantity: null,
        price: null,
        gross: input.amount,
        cost,
        firstBoughtOn: a.purchaseDate,
        closedPosition: true,
        lots: [{ lotId: null, purchaseDate: a.purchaseDate.toISOString(), quantity: a.quantity != null ? Number(a.quantity) : null, price: null, cost }],
        snapshot: { assetType: a.assetType, name: a.name, quantity: a.quantity?.toString() ?? null, unit: a.unit, purchasePrice: a.purchasePrice.toString(), currentValue: a.currentValue.toString(), currency: a.currency, purchaseDate: a.purchaseDate.toISOString(), notes: a.notes },
        label: `Sold ${a.name}`,
        apply: async (t) => {
          await t.otherAsset.delete({ where: { id: a.id } });
        },
      };
    }
  }
}

export async function recordSale(userId: string, input: CreateSaleInput) {
  return db.$transaction(async (tx: Tx) => {
    assertNotFuture(input.soldOn);
    const p = await prepare(tx, userId, input);

    const charges = input.charges ?? 0;
    const net = roundMoney(p.gross - charges);
    if (!(net > 0)) throw new ValidationError("Charges can't be as much as the sale amount.");

    const account = await tx.account.findFirst({ where: { id: input.accountId, userId } });
    if (!account) throw new ValidationError("Choose the account the money went to.");
    if (account.status === "CLOSED") throw new ValidationError(`${account.name} is closed. Pick an open account.`);
    let credited = net;
    if (account.currency !== p.currency) {
      if (!input.creditedAmount) {
        throw new ValidationError(`${account.name} is in ${account.currency}. Enter the ${account.currency} amount that arrived.`);
      }
      credited = input.creditedAmount;
    }

    const sale = await tx.investmentSale.create({
      data: {
        userId,
        kind: p.kind,
        holdingId: input.holdingId,
        name: p.name,
        detail: p.detail,
        currency: p.currency,
        quantity: p.quantity,
        price: p.price,
        grossProceeds: p.gross,
        charges,
        netProceeds: net,
        costBasis: p.cost,
        realizedPnl: roundMoney(net - p.cost),
        firstBoughtOn: p.firstBoughtOn,
        soldOn: input.soldOn,
        closedPosition: p.closedPosition,
        accountId: account.id,
        creditedAmount: credited,
        lots: p.lots as unknown as Prisma.InputJsonValue,
        snapshot: p.snapshot,
        note: input.note || null,
      },
    });
    await p.apply(tx);
    await postInvestmentSale(tx, userId, {
      saleId: sale.id,
      accountId: account.id,
      amount: credited,
      currency: account.currency,
      date: input.soldOn,
      description: p.label,
    });
    await audit(tx, userId, "InvestmentSale", sale.id, "SELL", `${p.label}; ${credited} ${account.currency} to ${account.name}`);
    return sale;
  });
}

/** Undoes a sale: takes the money back out of the account and restores the
 * purchases it used, recreating the holding if the sale had closed it. */
export async function undoSale(userId: string, saleId: string) {
  return db.$transaction(async (tx: Tx) => {
    const sale = await tx.investmentSale.findFirst({ where: { id: saleId, userId } });
    if (!sale) throw new ValidationError("Sale not found.");
    if (sale.reversedAt) throw new ValidationError("This sale was already undone.");
    await reverseInvestmentSale(tx, userId, sale.id, `Undo: ${sale.name} sale`);

    const lots = sale.lots as unknown as SoldLot[];
    const snap = sale.snapshot as Record<string, string | boolean | null>;
    switch (sale.kind) {
      case "STOCK": {
        let holding = await tx.stockHolding.findFirst({ where: { id: sale.holdingId, userId } });
        // Bought again since? Purchases go back into that holding.
        holding ??= await tx.stockHolding.findFirst({ where: { userId, ticker: String(snap.ticker), exchange: (snap.exchange as string | null) ?? null, currency: sale.currency } });
        holding ??= await tx.stockHolding.create({
          data: {
            id: sale.holdingId,
            userId,
            ticker: String(snap.ticker),
            exchange: (snap.exchange as string | null) ?? null,
            currency: sale.currency,
            quantity: Number(sale.quantity),
            avgBuyPrice: 0,
            purchaseDate: sale.firstBoughtOn,
            lastPrice: snap.lastPrice != null ? Number(snap.lastPrice) : null,
            lastPriceAt: snap.lastPriceAt ? new Date(String(snap.lastPriceAt)) : null,
            previousClose: snap.previousClose != null ? Number(snap.previousClose) : null,
          },
        });
        for (const l of lots) {
          const existing = l.lotId ? await tx.stockPurchaseLot.findFirst({ where: { id: l.lotId, stockHoldingId: holding.id } }) : null;
          if (existing) await tx.stockPurchaseLot.update({ where: { id: existing.id }, data: { quantity: { increment: l.quantity ?? 0 } } });
          else await tx.stockPurchaseLot.create({ data: { stockHoldingId: holding.id, quantity: l.quantity ?? 0, price: l.price ?? 0, purchaseDate: new Date(l.purchaseDate) } });
        }
        await recomputeHoldingFromLots(holding.id, tx);
        break;
      }
      case "MUTUAL_FUND": {
        let fund = await tx.mutualFundHolding.findFirst({ where: { id: sale.holdingId, userId } });
        fund ??= await tx.mutualFundHolding.findFirst({
          where: { userId, currency: sale.currency, ...(snap.schemeCode ? { schemeCode: String(snap.schemeCode) } : { fundName: { equals: String(snap.fundName), mode: "insensitive" as const } }) },
        });
        fund ??= await tx.mutualFundHolding.create({
          data: {
            id: sale.holdingId,
            userId,
            fundName: String(snap.fundName),
            schemeCode: (snap.schemeCode as string | null) ?? null,
            currency: sale.currency,
            units: Number(sale.quantity),
            avgNav: 0,
            purchaseDate: sale.firstBoughtOn,
            lastNav: snap.lastNav != null ? Number(snap.lastNav) : null,
            lastNavAt: snap.lastNavAt ? new Date(String(snap.lastNavAt)) : null,
          },
        });
        for (const l of lots) {
          const existing = l.lotId ? await tx.mutualFundLot.findFirst({ where: { id: l.lotId, holdingId: fund.id } }) : null;
          if (existing) await tx.mutualFundLot.update({ where: { id: existing.id }, data: { units: { increment: l.quantity ?? 0 } } });
          else await tx.mutualFundLot.create({ data: { holdingId: fund.id, units: l.quantity ?? 0, nav: l.price ?? 0, purchaseDate: new Date(l.purchaseDate) } });
        }
        await recomputeFundFromLots(fund.id, tx);
        break;
      }
      case "FIXED_DEPOSIT": {
        const linked = snap.linkedAccountId ? await tx.account.findFirst({ where: { id: String(snap.linkedAccountId), userId } }) : null;
        await tx.fixedDeposit.create({
          data: {
            id: sale.holdingId,
            userId,
            bank: String(snap.bank),
            principal: Number(snap.principal),
            interestRate: Number(snap.interestRate),
            startDate: new Date(String(snap.startDate)),
            maturityDate: new Date(String(snap.maturityDate)),
            currency: sale.currency,
            linkedAccountId: linked?.id ?? null,
          },
        });
        break;
      }
      case "OTHER": {
        await tx.otherAsset.create({
          data: {
            id: sale.holdingId,
            userId,
            assetType: snap.assetType as Prisma.OtherAssetCreateInput["assetType"],
            name: String(snap.name),
            quantity: snap.quantity != null ? Number(snap.quantity) : null,
            unit: (snap.unit as string | null) ?? null,
            purchasePrice: Number(snap.purchasePrice),
            currentValue: Number(snap.currentValue),
            currency: sale.currency,
            purchaseDate: new Date(String(snap.purchaseDate)),
            notes: (snap.notes as string | null) ?? null,
          },
        });
        break;
      }
    }
    const undone = await tx.investmentSale.update({ where: { id: sale.id }, data: { reversedAt: new Date() } });
    await audit(tx, userId, "InvestmentSale", sale.id, "UNDO_SELL", `Undid sale of ${sale.name}`);
    return undone;
  });
}

export async function listSales(userId: string) {
  return db.investmentSale.findMany({
    where: { userId },
    include: { account: { select: { id: true, name: true, currency: true, status: true } } },
    orderBy: [{ soldOn: "desc" }, { createdAt: "desc" }],
  });
}
