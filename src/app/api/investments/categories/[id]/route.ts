import { z } from "zod";
import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { deleteCategory, updateCategory } from "@/lib/investment-categories";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ name: z.string().max(80).optional(), color: z.number().int().min(1).max(8).optional() });

/** Renames or recolours a category; it shows the new name everywhere. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, patchSchema);
  return { category: await updateCategory(userId, params.id, input) };
});

/** Removes a category. Its investments are untouched; they're only ungrouped. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => deleteCategory(userId, params.id));
