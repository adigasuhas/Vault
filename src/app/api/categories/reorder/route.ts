import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { reorderCategoriesSchema } from "@/lib/schemas";
import { reorderCategories } from "@/lib/categories";

export const dynamic = "force-dynamic";

/** Reorders one set of siblings: the top level, or one parent's subcategories. */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, reorderCategoriesSchema);
  return reorderCategories(userId, input.parentId, input.order);
});
