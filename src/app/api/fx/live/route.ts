import { authed } from "@/lib/api";
import { userLiveRate } from "@/lib/fx-live";

export const dynamic = "force-dynamic";

/** Live secondary → primary rate (null without a secondary currency or when
 * the provider has nothing). Fresh at most every five minutes. */
export const GET = authed(async (_req, { userId }) => ({ live: await userLiveRate(userId) }));
