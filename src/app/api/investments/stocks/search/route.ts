import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { searchStocks } from "@/lib/market-data";

export const dynamic = "force-dynamic";

/** Backs the ticker autocomplete in the "Add Stock" dialog — looks up Yahoo
 * Finance symbols by company name so a user doesn't have to already know the
 * exact ticker (e.g. "RELIANCE.NS"). */
export async function GET(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const query = req.nextUrl.searchParams.get("q") || "";
  const exchange = req.nextUrl.searchParams.get("exchange") || undefined;
  const results = query.trim().length >= 2 ? await searchStocks(query, exchange) : [];

  return NextResponse.json({ results });
}
