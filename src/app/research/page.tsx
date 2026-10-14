import { redirect } from "next/navigation";

/** Research lives inside Investments now. Old links open its search there. */
export default function ResearchPage() {
  redirect("/investments?research=");
}
