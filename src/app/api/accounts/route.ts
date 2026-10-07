import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { createAccountSchema } from "@/lib/schemas";
import { createAccount } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** Open and archived accounts by default; `?includeClosed=1` adds closed ones
 * (their history stays browsable). */
export const GET = authed(async (req, { userId }) => {
  const includeClosed = req.nextUrl.searchParams.get("includeClosed") === "1";
  const accounts = await db.account.findMany({
    where: { userId, ...(includeClosed ? {} : { status: { not: "CLOSED" } }) },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  return { accounts };
});

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createAccountSchema);
  const account = await createAccount(userId, {
    name: input.name,
    bankName: input.bankName,
    branchName: input.branchName,
    accountNumber: input.accountNumber,
    currency: input.currency,
    accountType: input.accountType,
    openingBalance: input.openingBalance ?? 0,
    openingDate: input.openingDate,
    creditLimit: input.creditLimit ?? null,
    notes: input.notes,
  });
  return Response.json({ account }, { status: 201 });
});
