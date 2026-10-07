import { authed } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { confirmOccurrenceSchema, noteSchema } from "@/lib/schemas";
import { confirmOccurrence, restoreSkipped, reverseOccurrence, skipOccurrence } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** POST /api/occurrences/:id/{confirm|skip|reverse|restore} */
export const POST = authed<{ id: string; action: string }>(async (req, { userId, params }) => {
  const body = async <T,>(schema: Parameters<typeof parseJson<T>>[1]) =>
    parseJson(req, schema).catch((e) => {
      if (e instanceof ValidationError && e.message.includes("valid JSON")) return {} as T;
      throw e;
    });
  switch (params.action) {
    case "confirm": {
      const input = await body(confirmOccurrenceSchema);
      return { occurrence: await confirmOccurrence(userId, params.id, input) };
    }
    case "skip": {
      const input = await body(noteSchema);
      return { occurrence: await skipOccurrence(userId, { executionId: params.id }, input.note ?? input.reason) };
    }
    case "reverse": {
      const input = await body(noteSchema);
      return { occurrence: await reverseOccurrence(userId, params.id, input.reason ?? input.note) };
    }
    case "restore":
      return restoreSkipped(userId, params.id);
    default:
      throw new ValidationError("Unknown action.");
  }
});
