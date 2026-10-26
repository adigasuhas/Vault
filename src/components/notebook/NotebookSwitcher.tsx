"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BookOpen, ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Notebook {
  id: string;
  name: string;
  createdAt: string;
  entries: number;
  open: number;
  converted: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pick, create, rename and delete notebooks. Lives in the Notebook header. */
export function NotebookSwitcher({
  notebooks,
  current,
  onOpen,
  onChanged,
}: {
  notebooks: Notebook[];
  current: string;
  onOpen: (id: string) => void;
  /** Reload the list (names, counts). */
  onChanged: () => Promise<void> | void;
}) {
  const nb = notebooks.find((n) => n.id === current) ?? notebooks[0];
  const [naming, setNaming] = useState<{ mode: "CREATE" | "RENAME" } | null>(null);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="min-w-0 max-w-[16rem] justify-between gap-2" aria-label={`Notebook: ${nb?.name}. Switch notebook`}>
            <BookOpen className="h-4 w-4 shrink-0 text-brass" strokeWidth={1.75} />
            <span className="truncate">{nb?.name}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Notebooks</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={current} onValueChange={onOpen}>
            {notebooks.map((n) => (
              <DropdownMenuRadioItem key={n.id} value={n.id} className="pr-2">
                <span className="min-w-0 flex-1 truncate">{n.name}</span>
                <span className="ml-3 shrink-0 text-xs tabular-nums text-muted-foreground">{n.entries}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNaming({ mode: "CREATE" })}>
            <Plus className="h-4 w-4" /> New notebook…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Manage ${nb?.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setNaming({ mode: "RENAME" })}><Pencil className="h-4 w-4" /> Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNaming({ mode: "CREATE" })}><Plus className="h-4 w-4" /> New notebook…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={notebooks.length < 2} onClick={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" /> {notebooks.length < 2 ? "Delete (your only notebook)" : "Delete…"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {naming && (
        <NameDialog
          mode={naming.mode}
          notebook={naming.mode === "RENAME" ? nb : null}
          taken={notebooks.filter((n) => naming.mode === "CREATE" || n.id !== nb.id).map((n) => n.name)}
          onClose={() => setNaming(null)}
          onDone={async (id) => {
            await onChanged();
            if (naming.mode === "CREATE") onOpen(id);
          }}
        />
      )}
      {deleting && nb && (
        <DeleteDialog
          notebook={nb}
          others={notebooks.filter((n) => n.id !== nb.id)}
          onClose={() => setDeleting(false)}
          onDone={async (next) => {
            onOpen(next);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function NameDialog({
  mode,
  notebook,
  taken,
  onClose,
  onDone,
}: {
  mode: "CREATE" | "RENAME";
  notebook: Notebook | null;
  taken: string[];
  onClose: () => void;
  onDone: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(notebook?.name ?? "");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const clash = taken.some((t) => t.toLowerCase() === trimmed.toLowerCase());
  const problem = !trimmed ? null : trimmed.length > 60 ? "Keep the name under 60 characters." : clash ? `You already have a notebook called "${trimmed}".` : null;
  const unchanged = mode === "RENAME" && trimmed === notebook?.name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || problem || unchanged) return;
    setBusy(true);
    try {
      const r =
        mode === "CREATE"
          ? await api<{ notebook: { id: string } }>("/api/notebooks", { body: { name: trimmed } })
          : await api<{ notebook: { id: string } }>(`/api/notebooks/${notebook!.id}`, { method: "PATCH", body: { name: trimmed } });
      toast.success(mode === "CREATE" ? `${trimmed} created.` : `Renamed to ${trimmed}.`);
      await onDone(r.notebook.id);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "CREATE" ? "New notebook" : `Rename ${notebook?.name}`}</DialogTitle>
            <DialogDescription>
              {mode === "CREATE" ? "A separate notebook for a trip, a move or a project. Its entries and totals stay apart from your other notebooks." : "Only the name changes. Its entries stay as they are."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nb-name">Name</Label>
            <Input id="nb-name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Liverpool move" aria-invalid={!!problem} aria-describedby="nb-name-hint" />
            <p id="nb-name-hint" className={cn("text-xs", problem ? "text-negative" : "text-muted-foreground")}>{problem ?? "Up to 60 characters."}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !trimmed || !!problem || unchanged}>{busy ? "Saving…" : mode === "CREATE" ? "Create notebook" : "Rename"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  notebook,
  others,
  onClose,
  onDone,
}: {
  notebook: Notebook;
  others: Notebook[];
  onClose: () => void;
  /** Called with the notebook to open next. */
  onDone: (next: string) => Promise<void>;
}) {
  const has = notebook.entries > 0;
  const [choice, setChoice] = useState<"MOVE" | "DELETE">("MOVE");
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const canDeleteEntries = notebook.converted === 0;
  const target = others.find((o) => o.id === moveTo);

  async function submit() {
    setBusy(true);
    try {
      const body = !has ? {} : choice === "MOVE" ? { moveTo } : { deleteEntries: true };
      await api(`/api/notebooks/${notebook.id}`, { method: "DELETE", body });
      toast.success(
        !has
          ? `${notebook.name} deleted.`
          : choice === "MOVE"
            ? `${notebook.name} deleted. Its ${plural(notebook.entries, "entry is", "entries are")} now in ${target?.name}.`
            : `${notebook.name} and its ${plural(notebook.entries, "entry", "entries")} deleted.`
      );
      await onDone(has && choice === "MOVE" ? moveTo : others[0].id);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {notebook.name}?</DialogTitle>
          <DialogDescription>
            {has ? `It has ${plural(notebook.entries, "entry", "entries")}. Choose what happens to ${notebook.entries === 1 ? "it" : "them"}.` : "It's empty, so nothing else changes."}
          </DialogDescription>
        </DialogHeader>
        {has && (
          <div role="radiogroup" aria-label="What happens to its entries" className="space-y-2">
            <label className={cn("flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors", choice === "MOVE" ? "border-foreground/40 bg-card shadow-card" : "border-border")}>
              <input type="radio" name="nb-delete" className="mt-0.5 accent-[var(--brass)]" checked={choice === "MOVE"} onChange={() => setChoice("MOVE")} />
              <span className="min-w-0 flex-1 space-y-2">
                <span className="block text-sm">Move {notebook.entries === 1 ? "it" : "them"} to another notebook <span className="ml-1 text-[11px] text-muted-foreground">recommended</span></span>
                <Select value={moveTo} onValueChange={setMoveTo} disabled={choice !== "MOVE"}>
                  <SelectTrigger className="w-full" aria-label="Move entries to"><SelectValue /></SelectTrigger>
                  <SelectContent>{others.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </span>
            </label>
            <label className={cn("flex gap-2.5 rounded-lg border p-3 transition-colors", !canDeleteEntries ? "cursor-not-allowed opacity-60" : "cursor-pointer", choice === "DELETE" ? "border-negative/50 bg-negative-soft" : "border-border")}>
              <input type="radio" name="nb-delete" className="mt-0.5 accent-[var(--negative)]" checked={choice === "DELETE"} disabled={!canDeleteEntries} onChange={() => setChoice("DELETE")} />
              <span className="min-w-0">
                <span className="block text-sm">Delete {notebook.entries === 1 ? "the entry" : `all ${notebook.entries} entries`} too</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {canDeleteEntries
                    ? "They're only notes, so no balance, budget or loan changes, but they can't be brought back."
                    : `${plural(notebook.converted, "entry was", "entries were")} turned into a loan, expense or receivable, so they have to be moved, not deleted.`}
                </span>
              </span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || (has && choice === "MOVE" && !moveTo)}>
            {busy ? "Deleting…" : !has ? "Delete notebook" : choice === "MOVE" ? "Move entries and delete" : `Delete notebook and ${plural(notebook.entries, "entry", "entries")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
