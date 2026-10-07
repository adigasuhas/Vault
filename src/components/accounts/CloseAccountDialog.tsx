"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/currencies";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

interface Acct {
  id: string;
  name: string;
  currency: string;
  currentBalance: string | number;
  status: string;
}

/**
 * Closing an account. Accounts are never deleted: closing freezes the
 * account and keeps its full statement. Money left in it must go somewhere —
 * moved to another account of the same currency, or written off, which needs
 * the account's name typed out.
 */
export function CloseAccountDialog({
  account,
  accounts,
  open,
  onOpenChange,
  onClosed,
}: {
  account: Acct | null;
  accounts: Acct[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onClosed: () => void;
}) {
  const [mode, setMode] = useState<"move" | "writeoff">("move");
  const [target, setTarget] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!account) return null;

  const balance = Math.round(Number(account.currentBalance) * 100) / 100;
  const hasBalance = balance !== 0;
  const targets = accounts.filter((a) => a.id !== account.id && a.currency === account.currency && a.status !== "CLOSED");
  const canMove = hasBalance && balance > 0 && targets.length > 0;
  const effectiveMode = hasBalance ? (canMove ? mode : "writeoff") : "none";
  const ready =
    effectiveMode === "none" || (effectiveMode === "move" && !!target) || (effectiveMode === "writeoff" && confirmName.trim() === account.name.trim());

  const reset = () => {
    setMode("move");
    setTarget("");
    setConfirmName("");
    setNote("");
  };

  async function submit() {
    setBusy(true);
    try {
      await api(`/api/accounts/${account!.id}/close`, {
        body: {
          ...(effectiveMode === "move" ? { transferToAccountId: target } : {}),
          ...(effectiveMode === "writeoff" ? { writeOff: true, confirmName } : {}),
          note: note || undefined,
        },
      });
      toast.success(`${account!.name} is closed. Its statement stays under Closed accounts.`);
      reset();
      onOpenChange(false);
      onClosed();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close {account.name}?</DialogTitle>
          <DialogDescription>
            The account stops taking transactions and drops out of your balances. Its full history stays in the ledger and in reports.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
          <p className="eyebrow">Balance today</p>
          <p className={cn("mt-1 text-xl font-semibold tabular-nums", balance < 0 && "text-negative")}>{formatMoney(balance, account.currency)}</p>
        </div>

        {hasBalance && (
          <div className="space-y-3">
            <p className="text-sm font-medium">What should happen to the balance?</p>
            {canMove && (
              <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors", effectiveMode === "move" ? "border-foreground/40 bg-card" : "border-border")}>
                <input type="radio" className="mt-1 accent-[var(--brass)]" checked={effectiveMode === "move"} onChange={() => setMode("move")} />
                <div className="flex-1 space-y-2">
                  <p className="text-sm">Move it to another account</p>
                  <p className="text-xs text-muted-foreground">Recorded as a transfer, so both statements show where it went.</p>
                  {effectiveMode === "move" && (
                    <Select value={target} onValueChange={setTarget}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={`Choose a ${account.currency} account`} /></SelectTrigger>
                      <SelectContent>
                        {targets.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(a.currentBalance, a.currency)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </label>
            )}
            <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors", effectiveMode === "writeoff" ? "border-negative/50 bg-negative-soft/40" : "border-border")}>
              <input type="radio" className="mt-1 accent-[var(--negative)]" checked={effectiveMode === "writeoff"} onChange={() => setMode("writeoff")} />
              <div className="flex-1 space-y-2">
                <p className="text-sm">Write it off</p>
                <p className="text-xs text-muted-foreground">
                  {balance < 0
                    ? "Clears what's owed without a payment. Only use this if it was settled outside VAULT."
                    : "The money leaves your net worth. Use it for cash spent without tracking, or a balance the bank kept."}{" "}
                  An adjustment to zero is posted and logged.
                </p>
                {!canMove && balance > 0 && (
                  <p className="text-xs text-muted-foreground">No other open {account.currency} account to move it to.</p>
                )}
                {effectiveMode === "writeoff" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="close-confirm" className="text-xs">
                      Type <span className="font-semibold text-foreground">{account.name}</span> to confirm
                    </Label>
                    <Input id="close-confirm" autoComplete="off" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
                  </div>
                )}
              </div>
            </label>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="close-note" className="text-xs">Note (optional)</Label>
          <Input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Moved banks after the fellowship ended" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Keep account open</Button>
          <Button variant="danger" onClick={submit} disabled={!ready || busy}>
            {busy ? "Closing…" : effectiveMode === "move" ? "Move balance & close" : effectiveMode === "writeoff" ? "Write off & close" : "Close account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
