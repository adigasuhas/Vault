"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "@/context/SessionContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Users, UserPlus, Trash2, ShieldAlert, Database } from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/ConfirmAction";

interface DevUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  createdAt: string;
  lastLogin: string | null;
}

interface Usage { accounts: number; ledgerEntries: number; notebookEntries: number; holdings: number; schedules: number; records: number }
interface Storage {
  database: { bytes: number; limitBytes: number; usedPct: number };
  tables: { name: string; bytes: number; rows: number }[];
  perUser: Record<string, Usage>;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

interface AuditEntry {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
  actor: { email: string };
}

export default function DeveloperPage() {
  const { user } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<DevUser[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [stats, setStats] = useState({ totalUsers: 0, activeUsers: 0, totalAccounts: 0 });
  const [storage, setStorage] = useState<Storage | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("USER");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/developer/users?audit=1");
    if (res.status === 403) {
      router.push("/dashboard");
      return;
    }
    const data = await res.json();
    // Storage is extra detail: the page still works if it can't be read.
    fetch("/api/developer/storage").then((r) => (r.ok ? r.json() : null)).then(setStorage).catch(() => setStorage(null));
    setUsers(data.users || []);
    setAuditLog(data.auditLog || []);
    setStats(data.stats || { totalUsers: 0, activeUsers: 0, totalAccounts: 0 });
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/developer/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, password, role }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to create user.");
    setOpen(false);
    setEmail("");
    setName("");
    setPassword("");
    toast.success("User created.");
    load();
  }

  async function handleStatusChange(id: string, status: string) {
    const res = await fetch(`/api/developer/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast.success("User updated.");
      load();
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/developer/users/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "Failed to delete user.");
    toast.success("User deleted.");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[1.9rem] leading-tight">Developer</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage users and watch storage. Only developer accounts can see this page.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="cursor-pointer"><UserPlus className="h-4 w-4" />New user</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Create user</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">User</SelectItem>
                    <SelectItem value="DEVELOPER">Developer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saving} className="w-full cursor-pointer">{saving ? "Creating…" : "Create"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-5">
            <p className="text-xs text-muted-foreground">Total users</p>
            <p className="text-xl font-bold mt-1">{stats.totalUsers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <p className="text-xs text-muted-foreground">Active users</p>
            <p className="text-xl font-bold mt-1">{stats.activeUsers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <p className="text-xs text-muted-foreground">Accounts created</p>
            <p className="text-xl font-bold mt-1">{stats.totalAccounts}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-muted-foreground" />Storage</h2>
            {storage && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatBytes(storage.database.bytes)} of {formatBytes(storage.database.limitBytes)} · {storage.database.usedPct}% used
              </p>
            )}
          </div>
          {!storage ? (
            <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "Storage details aren't available."}</p>
          ) : (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Database storage used" aria-valuenow={storage.database.usedPct} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={storage.database.usedPct >= 90 ? "h-full bg-destructive" : storage.database.usedPct >= 75 ? "h-full bg-warning" : "h-full bg-brass"}
                  style={{ width: `${Math.min(100, Math.max(storage.database.usedPct, 1))}%` }}
                />
              </div>
              {storage.database.usedPct >= 75 && (
                <p className="text-xs text-warning">The database is getting close to its plan&apos;s limit. Writes stop when it&apos;s full.</p>
              )}
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Largest tables</p>
                <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  {storage.tables.map((t) => (
                    <div key={t.name} className="flex justify-between gap-3 border-b border-border/60 py-1 last:border-0">
                      <span className="truncate font-mono text-[11px]">{t.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{t.rows.toLocaleString("en-IN")} {t.rows === 1 ? "row" : "rows"} · {formatBytes(t.bytes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Users className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No users found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground">{u.name || "–"}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "DEVELOPER" ? "default" : "secondary"}>{u.role}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {(() => {
                        const x = storage?.perUser[u.id];
                        if (!storage) return "–";
                        if (!x) return "No records";
                        return (
                          <span title={`${x.accounts} accounts · ${x.ledgerEntries} ledger entries · ${x.notebookEntries} notebook entries · ${x.holdings} holdings · ${x.schedules} schedules`}>
                            {x.records.toLocaleString("en-IN")} records · {x.accounts} accounts
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Never"}
                    </TableCell>
                    <TableCell>
                      <Select value={u.status} onValueChange={(v) => handleStatusChange(u.id, v)}>
                        <SelectTrigger className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="SUSPENDED">Suspended</SelectItem>
                          <SelectItem value="DISABLED">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <ConfirmAction
                        title={`Delete ${u.email}?`}
                        description="This permanently deletes the user and ALL of their financial data: accounts, transactions, budgets and investments. This cannot be undone."
                        confirmLabel="Permanently delete"
                        onConfirm={() => handleDelete(u.id)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 cursor-pointer text-destructive hover:text-destructive"
                            aria-label={`Delete ${u.email}`}
                            disabled={u.id === user?.id}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5">
          <h2 className="text-sm font-semibold mb-3">Recent admin activity</h2>
          {auditLog.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No admin actions recorded yet.</p>
          ) : (
            <div className="space-y-1.5">
              {auditLog.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 text-xs border-b border-border py-2 last:border-0">
                  <div className="min-w-0">
                    <span className="font-mono text-[11px] text-muted-foreground">{a.action}</span>
                    <span className="ml-2 text-foreground">{a.detail}</span>
                  </div>
                  <span className="shrink-0 text-muted-foreground">
                    {a.actor?.email} · {new Date(a.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!user?.isDeveloper && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-destructive">
            <ShieldAlert className="h-4 w-4" />
            This page is restricted to Developer-role accounts.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
