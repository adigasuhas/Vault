import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { ensureDefaultCategories } from "@/lib/defaults";
import { parseJson, ValidationError } from "@/lib/validate";
import { z } from "zod";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => {
  await ensureDefaultCategories(userId);
  const categories = await db.category.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true, defaultAmount: true, defaultAccountId: true, defaultSince: true },
  });
  return { categories };
});

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

/** Creates a category without budgeting it (e.g. from the expense form). */
export const POST = authed(async (req, { userId }) => {
  const { name } = await parseJson(req, createSchema);
  const dup = await db.category.findFirst({ where: { userId, name: { equals: name, mode: "insensitive" } } });
  if (dup) return { category: dup };
  const max = await db.category.aggregate({ where: { userId }, _max: { sortOrder: true } });
  try {
    const category = await db.category.create({ data: { userId, name, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
    return Response.json({ category }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ValidationError("That category already exists.");
    throw err;
  }
});
