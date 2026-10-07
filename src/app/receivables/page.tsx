"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, localToday } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { PageHeader } from "@/components/app/PageHeader";
import { SchedulesBoard } from "@/components/schedules/SchedulesBoard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

interface Account { id: string; name: string; currency: string; status: string; currentBalance: string }

function ReceivedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localToday());
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAmount("");
    setDescription("");
    setDate(localToday());
    api<{ accounts: Account[] }>("/api/accounts").then((d) => {
      const list = d.accounts.filter((a) => a.status !== "CLOSED");
      setAccounts(list);
      setAccountId((id) => id || list[0]?.id || "");
    });
  }, [open]);
  const acct = accounts.find((a) => a.id === accountId);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/income", { body: { accountId, amount: Number(amount), date, description } });
      toast.success(`${formatMoney(Number(amount), acct!.currency)} recorded in ${acct!.name}.`);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Money received</DialogTitle>
            <DialogDescription>One-off money that wasn&apos;t scheduled, like a refund, a prize or a gift.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="r-desc">What was it?</Label>
            <Input id="r-desc" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Conference travel reimbursement" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-amt">Amount{acct ? ` (${acct.currency})` : ""}</Label>
              <Input id="r-amt" type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-date">Date</Label>
              <Input id="r-date" type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Into</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {a.currency}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !(Number(amount) > 0) || !accountId || !description.trim()}>{busy ? "Saving…" : "Record"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ReceivablesPage() {
  const search = useSearchParams();
  const [received, setReceived] = useState(false);
  useEffect(() => {
    if (search.get("income") === "1") setReceived(true);
  }, [search]);
  return (
    <div className="space-y-8">
      <SchedulesBoard
        direction="INCOME"
        openNew={search.get("new") === "1"}
        headerActions={(open) => (
          <PageHeader
            title="Receivables"
            description="Money you're expecting: salary, stipends, refunds, pocket money. Nothing lands in your account until you confirm it arrived, unless you switch on automatic."
            actions={
              <>
                <Button variant="outline" onClick={() => setReceived(true)}>Money received</Button>
                <Button onClick={open}><Plus /> Schedule income</Button>
              </>
            }
          />
        )}
      />
      <ReceivedDialog open={received} onOpenChange={setReceived} />
    </div>
  );
}
