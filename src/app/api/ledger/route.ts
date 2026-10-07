import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { signedAmount } from "@/lib/ledger";
import { buildXlsx } from "@/lib/xlsx";
import { isoDate } from "@/lib/dates";
import { queryDate } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TYPES = ["EXPENSE", "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT", "OPENING", "REVERSAL", "INVESTMENT_SALE"] as const;
export const TYPE_LABEL: Record<string, string> = {
  EXPENSE: "Expense",
  INCOME: "Income",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTMENT: "Adjustment",
  OPENING: "Opening balance",
  REVERSAL: "Reversal",
  INVESTMENT_SALE: "Investment sale",
};
const PAGE = 60;
const NO_ACCOUNT = "No account";

/**
 * The whole ledger across accounts: every entry ever posted, including
 * reversed ones and their reversals. `?format=xlsx|csv` exports exactly the
 * filtered rows (all of them, not just one page).
 */
export const GET = authed(async (req, { userId }) => {
  const sp = req.nextUrl.searchParams;
  const where: Prisma.LedgerEntryWhereInput = { userId };
  const from = queryDate(sp, "from");
  const to = queryDate(sp, "to");
  if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (sp.get("accountId")) where.accountId = sp.get("accountId")!;
  const type = sp.get("type");
  if (type && TYPES.includes(type as never)) where.type = type as (typeof TYPES)[number];
  const q = sp.get("q")?.trim();
  if (q) where.OR = [{ description: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } }];
  const state = sp.get("state");
  if (state === "reversed") where.OR = [...(where.OR ?? []), { reversedAt: { not: null } }, { type: "REVERSAL" }];

  const format = sp.get("format");
  const page = Math.max(0, Number(sp.get("page")) || 0);
  const exporting = format === "xlsx" || format === "csv";
  const [total, entries] = await Promise.all([
    db.ledgerEntry.count({ where }),
    db.ledgerEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: exporting ? 0 : page * PAGE,
      take: exporting ? 50_000 : PAGE,
      include: {
        account: { select: { id: true, name: true, currency: true, status: true } },
        category: { select: { name: true } },
        transfer: { select: { fromAccountId: true, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } } },
        creditExecution: { select: { scheduledCredit: { select: { name: true } } } },
      },
    }),
  ]);

  const rows = entries.map((e) => ({
    id: e.id,
    date: e.date,
    postedAt: e.createdAt,
    type: e.type,
    typeLabel: TYPE_LABEL[e.type],
    account: e.account,
    category: e.category?.name ?? null,
    description:
      e.description ||
      e.creditExecution?.scheduledCredit.name ||
      (e.transfer ? (e.transfer.fromAccountId === e.accountId ? `To ${e.transfer.toAccount.name}` : `From ${e.transfer.fromAccount.name}`) : null) ||
      e.category?.name ||
      TYPE_LABEL[e.type],
    amount: signedAmount(e.type, Number(e.amount)),
    currency: e.currency,
    reversedAt: e.reversedAt,
    isReversal: e.type === "REVERSAL",
    reversalOfId: e.reversalOfId,
  }));

  if (exporting) {
    const stamp = new Date().toISOString().slice(0, 10);
    const state = (r: (typeof rows)[number]) => (r.reversedAt ? "Reversed" : r.isReversal ? "Reversal" : "Posted");
    if (format === "csv") {
      const esc = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = ["Date", "Account", "Type", "Category", "Description", "Amount", "Currency", "State", "Entry ID", "Reverses entry"];
      const lines = [head.join(",")].concat(
        rows.map((r) => [isoDate(r.date), r.account?.name ?? NO_ACCOUNT, r.typeLabel, r.category ?? "", r.description, r.amount.toFixed(2), r.currency, state(r), r.id, r.reversalOfId ?? ""].map(esc).join(","))
      );
      return new NextResponse("﻿" + lines.join("\n") + "\n", {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vault-ledger-${stamp}.csv"` },
      });
    }
    const xlsx = buildXlsx([
      {
        name: "Ledger",
        columns: [
          { header: "Date", kind: "date", width: 12 },
          { header: "Account", width: 24 },
          { header: "Type", width: 15 },
          { header: "Category", width: 20 },
          { header: "Description", width: 40 },
          { header: "Amount", kind: "money", width: 14 },
          { header: "Currency", width: 9 },
          { header: "State", width: 10 },
          { header: "Posted at", width: 20 },
          { header: "Entry ID", width: 38 },
          { header: "Reverses entry", width: 38 },
        ],
        rows: rows.map((r) => [r.date, r.account?.name ?? NO_ACCOUNT, r.typeLabel, r.category, r.description, r.amount, r.currency, state(r), r.postedAt.toISOString().replace("T", " ").slice(0, 19), r.id, r.reversalOfId]),
      },
    ]);
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="vault-ledger-${stamp}.xlsx"`,
      },
    });
  }

  return { entries: rows, total, page, pageSize: PAGE, hasMore: (page + 1) * PAGE < total };
});
