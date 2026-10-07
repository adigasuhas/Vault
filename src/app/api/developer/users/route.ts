import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDeveloper } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { auditAdminAction } from "@/lib/audit";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { toAdminUser } from "@/lib/admin-user";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_CODES = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

export async function GET(req: NextRequest) {
  const developer = await requireDeveloper(req);
  if (!developer) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const wantAudit = searchParams.get("audit") === "1";

  const [users, totalUsers, activeUsers, totalAccounts, auditLog] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "desc" } }),
    db.user.count(),
    db.user.count({ where: { status: "ACTIVE" } }),
    db.account.count(),
    wantAudit
      ? db.adminAuditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { actor: { select: { email: true } } },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    users: users.map(toAdminUser),
    stats: { totalUsers, activeUsers, totalAccounts },
    ...(wantAudit ? { auditLog } : {}),
  });
}

export async function POST(req: NextRequest) {
  const developer = await requireDeveloper(req);
  if (!developer) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const { email: rawEmail, name, password, role, baseCurrency } = body || {};
  const email = typeof rawEmail === "string" ? rawEmail.toLowerCase().trim() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 10) {
    return NextResponse.json({ error: "Password must be at least 10 characters." }, { status: 400 });
  }
  if (baseCurrency && !CURRENCY_CODES.has(baseCurrency)) {
    return NextResponse.json({ error: "Unsupported base currency." }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });

  const user = await db.user.create({
    data: {
      email,
      name: typeof name === "string" ? name : undefined,
      passwordHash: hashPassword(password),
      role: role === "DEVELOPER" ? "DEVELOPER" : "USER",
      baseCurrency: baseCurrency || "INR",
      isOnboarded: true,
      avatarUrl: `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(email)}`,
    },
  });

  await auditAdminAction({
    actorId: developer.id,
    action: "user.create",
    targetUserId: user.id,
    detail: `${user.email} as ${user.role}`,
    req,
  });

  return NextResponse.json({ user: toAdminUser(user) }, { status: 201 });
}
