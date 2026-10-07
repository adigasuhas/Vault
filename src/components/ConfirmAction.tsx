"use client";

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Confirmation for consequential actions. Destructive confirms use the solid
 * red button; `requirePhrase` makes the user type a word (or a name) before
 * the confirm button enables; `withReason` collects an optional note that is
 * stored in the audit trail.
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  requirePhrase,
  withReason,
  onConfirm,
  open: openProp,
  onOpenChange,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requirePhrase?: string;
  withReason?: string;
  onConfirm: (reason?: string) => unknown | Promise<unknown>;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  const ready = !requirePhrase || phrase.trim() === requirePhrase;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        setOpen(o);
        if (!o) {
          setPhrase("");
          setReason("");
        }
      }}
    >
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {withReason && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason" className="text-xs">{withReason}</Label>
            <Input id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional. Saved in the activity log." />
          </div>
        )}
        {requirePhrase && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-phrase" className="text-xs">
              Type <span className="font-mono font-semibold text-foreground">{requirePhrase}</span> to confirm
            </Label>
            <Input id="confirm-phrase" autoComplete="off" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "danger" : "default"}
            disabled={busy || !ready}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim() || undefined);
                setOpen(false);
                setPhrase("");
                setReason("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
