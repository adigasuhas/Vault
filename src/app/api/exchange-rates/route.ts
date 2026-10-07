import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { setExchangeRateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Returns the latest rate (any mode) for the user's base currency against every
 * other supported currency, so Settings can show one row per currency regardless
 * of whether it was fetched automatically or entered manually. */
export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId } });
  const rates = await db.exchangeRate.findMany({
    where: { userId: session.userId, baseCurrency: user.baseCurrency },
    orderBy: { fetchedAt: "desc" },
  });

  const latestByTarget = new Map<string, (typeof rates)[number]>();
  for (const rate of rates) {
    if (!latestByTarget.has(rate.targetCurrency)) latestByTarget.set(rate.targetCurrency, rate);
  }

  const targets = SUPPORTED_CURRENCIES.map((c) => c.code).filter((c) => c !== user.baseCurrency);
  const result = targets.map((target) => {
    const rate = latestByTarget.get(target);
    return {
      targetCurrency: target,
      rate: rate ? Number(rate.rate) : null,
      mode: rate?.mode ?? null,
      fetchedAt: rate?.fetchedAt ?? null,
    };
  });

  return NextResponse.json({ baseCurrency: user.baseCurrency, exchangeRateMode: user.exchangeRateMode, rates: result });
}

/** Body: { targetCurrency, rate } — stores/overwrites a MANUAL rate for base -> target. */
export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let input;
  try {
    input = await parseJson(req, setExchangeRateSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }

  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (input.targetCurrency === user.baseCurrency) {
    return NextResponse.json({ error: "That is already your base currency." }, { status: 400 });
  }

  const record = await db.exchangeRate.upsert({
    where: {
      userId_baseCurrency_targetCurrency_mode: {
        userId: session.userId,
        baseCurrency: user.baseCurrency,
        targetCurrency: input.targetCurrency,
        mode: "MANUAL",
      },
    },
    update: { rate: input.rate, fetchedAt: new Date() },
    create: {
      userId: session.userId,
      baseCurrency: user.baseCurrency,
      targetCurrency: input.targetCurrency,
      rate: input.rate,
      mode: "MANUAL",
    },
  });

  return NextResponse.json({ rate: record });
}
