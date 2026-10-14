import { redirect } from "next/navigation";

/** Research lives inside Investments now. Old links open the company there. */
export default async function ResearchSymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  redirect(`/investments?research=${encodeURIComponent(decodeURIComponent(symbol))}`);
}
