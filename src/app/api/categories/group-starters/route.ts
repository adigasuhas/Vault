import { authed } from "@/lib/api";
import { groupStarterCategories } from "@/lib/categories";

export const dynamic = "force-dynamic";

/** Groups the starter categories (Food › Groceries, Eating out, …) for an
 * account made before categories could be nested. */
export const POST = authed(async (_req, { userId }) => groupStarterCategories(userId));
