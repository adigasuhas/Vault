import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ensureDefaultCategories } from "@/lib/defaults";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { patchSettingsSchema } from "@/lib/schemas";
import { refreshAutomaticExchangeRates } from "@/lib/fx";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const setting = await db.setting.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  return NextResponse.json({
    name: user.name,
    email: user.email,
    timezone: user.timezone,
    baseCurrency: user.baseCurrency,
    secondaryCurrency: user.secondaryCurrency,
    budgetCurrency: user.budgetCurrency ?? user.baseCurrency,
    exchangeRateMode: user.exchangeRateMode,
    isOnboarded: user.isOnboarded,
    notifyUpcomingCredits: setting.notifyUpcomingCredits,
    notifyUpcomingBills: setting.notifyUpcomingBills,
    budgetAlertThreshold: setting.budgetAlertThreshold,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let input;
  try {
    input = await parseJson(req, patchSettingsSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
  const {
    name, timezone, baseCurrency, secondaryCurrency, budgetCurrency, exchangeRateMode,
    notifyUpcomingCredits, notifyUpcomingBills, budgetAlertThreshold, isOnboarded,
  } = input;

  const before = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { baseCurrency: true } });

  const user = await db.user.update({
    where: { id: session.userId },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(baseCurrency !== undefined ? { baseCurrency } : {}),
      // A secondary equal to the primary adds nothing — store it as unset.
      ...(secondaryCurrency !== undefined ? { secondaryCurrency: secondaryCurrency && secondaryCurrency !== (baseCurrency ?? before.baseCurrency) ? secondaryCurrency : null } : {}),
      ...(budgetCurrency !== undefined ? { budgetCurrency: budgetCurrency || null } : {}),
      ...(exchangeRateMode !== undefined ? { exchangeRateMode } : {}),
      ...(isOnboarded !== undefined ? { isOnboarded } : {}),
    },
  });

  // Stored rates are keyed by base currency, so a base-currency change orphans
  // every automatic rate until the next daily cron — pull a fresh set now so
  // dashboards don't silently fall back to 1:1 (finding F16). Best-effort.
  if (baseCurrency && baseCurrency !== before.baseCurrency && user.exchangeRateMode === "AUTOMATIC") {
    await refreshAutomaticExchangeRates(user.id).catch((e) => console.error("post-settings FX refresh failed:", e));
  }

  await db.setting.upsert({
    where: { userId: user.id },
    update: {
      ...(notifyUpcomingCredits !== undefined ? { notifyUpcomingCredits } : {}),
      ...(notifyUpcomingBills !== undefined ? { notifyUpcomingBills } : {}),
      ...(budgetAlertThreshold !== undefined ? { budgetAlertThreshold } : {}),
    },
    create: { userId: user.id },
  });

  if (isOnboarded) {
    await ensureDefaultCategories(user.id);
  }

  return NextResponse.json({ success: true });
}
