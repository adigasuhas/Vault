import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runDueSchedules } from "@/lib/schedules";
import { refreshAutomaticExchangeRates } from "@/lib/fx";
import { recordAllNetWorthSnapshots } from "@/lib/networth";
import { db } from "@/lib/db";
import { remindersFor } from "@/lib/reminders";
import { sendReminderDigest } from "@/lib/email";

/** One email per user per day with whatever needs attention (skipped when
 * there's nothing, and for users who turned both upcoming reminders off). */
async function sendReminderDigests() {
  const users = await db.user.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, email: true, name: true, setting: true } });
  let sent = 0;
  for (const u of users) {
    if (u.setting && !u.setting.notifyUpcomingBills && !u.setting.notifyUpcomingCredits) continue;
    try {
      const items = await remindersFor(u.id);
      if (!items.length) continue;
      await sendReminderDigest(u.email, u.name, items.slice(0, 12).map((r) => `${r.title}. ${r.body}`), process.env.NEXT_PUBLIC_APP_URL ?? "");
      sent++;
    } catch (e) {
      console.error(`reminder digest failed for ${u.id}:`, e);
    }
  }
  return { users: users.length, sent };
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/** Runs once per day: brings schedules up to date, refreshes automatic FX
 * rates, records a net-worth snapshot for every user, and sends each user a
 * reminder digest when something needs attention. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const credits = await runDueSchedules(new Date());
  const fx = await refreshAutomaticExchangeRates();
  const snapshots = await recordAllNetWorthSnapshots();
  const digests = await sendReminderDigests();

  return NextResponse.json({ credits, fx, snapshots, digests });
}
