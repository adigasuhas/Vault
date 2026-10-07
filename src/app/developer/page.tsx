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
import { Users, UserPlus, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/ConfirmAction";

interface DevUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  createdAt: string;
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
          <p className="text-sm text-muted-foreground mt-1">Manage users. Only developer accounts can see this page.</p>
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
