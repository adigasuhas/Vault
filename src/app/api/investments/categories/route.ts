import { z } from "zod";
import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { db } from "@/lib/db";
import { findOrCreateCategory, listCategories } from "@/lib/investment-categories";

export const dynamic = "force-dynamic";

/** Every investment category with the investments in it ({ kind, holdingId }). */
export const GET = authed(async (_req, { userId }) => ({ categories: await listCategories(userId) }));

const createSchema = z.object({ name: z.string().max(80), color: z.number().int().min(1).max(8).optional() });

/** Creates a category (or returns the one that already has that name). */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createSchema);
  const { category, created } = await findOrCreateCategory(db, userId, input.name, input.color);
  return Response.json({ category, created }, { status: created ? 201 : 200 });
});
