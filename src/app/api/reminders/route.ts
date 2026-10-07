import { authed } from "@/lib/api";
import { remindersFor } from "@/lib/reminders";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => ({ reminders: await remindersFor(userId) }));
