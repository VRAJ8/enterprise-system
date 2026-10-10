import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { usersApi, errorMessage } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '../components/ui/dropdown-menu';
import { Search, Shield, Trash2, UserPlus, MoreHorizontal, UserX, UserCheck, Edit2, Loader2, KeyRound } from 'lucide-react';
import { motion } from 'framer-motion';
import { UserAvatar } from '../components/common';
import { ROLES, roleLabel, timeAgo } from '../lib/constants';

const roleColors = {
  admin: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  project_manager: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  team_member: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
};

const emptyInvite = { name: '', email: '', password: '', role: 'team_member', department: '', title: '' };

function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(12);
  window.crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState(emptyInvite);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await usersApi.list({ include_disabled: true });
      setUsers(res.data);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load users'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (u) => {
    setEditUser(u);
    setEditForm({ role: u.role, department: u.department || '', title: u.title || '', password: '' });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const payload = { role: editForm.role, department: editForm.department, title: editForm.title };
      if (editForm.password) payload.password = editForm.password;
      await usersApi.update(editUser.user_id, payload);
      toast.success(`Updated ${editUser.name}`);
      setEditUser(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const sendInvite = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await usersApi.create(invite);
      toast.success(`${invite.name} can now sign in`, {
        description: `Share their email and temporary password securely: ${invite.password}`,
        duration: 15000,
      });
      setInviteOpen(false);
      setInvite(emptyInvite);
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create user'));
    } finally {
      setSaving(false);
    }
  };

  const toggleDisabled = async (u) => {
    const disabling = !u.disabled;
    if (disabling && !window.confirm(`Deactivate ${u.name}? They won't be able to sign in. Their tasks and history are kept.`)) return;
    try {
      await usersApi.setStatus(u.user_id, disabling);
      toast.success(`${u.name} ${disabling ? 'deactivated' : 'reactivated'}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Permanently delete ${u.name}? Their tasks become unassigned. Consider deactivating instead.`)) return;
    try {
      await usersApi.delete(u.user_id);
      toast.success(`${u.name} deleted`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const q = search.toLowerCase();
  const filtered = users.filter((u) =>
    u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q));

  if (currentUser?.role !== 'admin') {
    return (
      <div className="text-center py-16">
        <Shield size={48} className="mx-auto text-muted-foreground/40 mb-4" />
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6" data-testid="user-management-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">User Management</h2>
          <p className="text-sm text-muted-foreground">
            {users.filter((u) => !u.disabled).length} active · {users.filter((u) => u.disabled).length} deactivated
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search name, email, department…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="pl-9" data-testid="user-search" />
          </div>
          <Button className="gap-1" onClick={() => { setInvite({ ...emptyInvite, password: tempPassword() }); setInviteOpen(true); }} data-testid="invite-user-btn">
            <UserPlus size={15} /> Add user
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {ROLES.map((role) => (
          <Card key={role} className="bg-card/50 border-border/30">
            <CardContent className="p-3 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${role === 'admin' ? 'bg-indigo-400' : role === 'project_manager' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
              <span className="text-xs text-muted-foreground">{roleLabel(role)}s</span>
              <span className="text-sm font-bold ml-auto">{users.filter((u) => u.role === role && !u.disabled).length}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card/70 border-border/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/40 hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No users found</TableCell></TableRow>
            ) : filtered.map((u) => (
              <TableRow key={u.user_id} className={`border-border/30 ${u.disabled ? 'opacity-50' : ''}`} data-testid={`user-row-${u.user_id}`}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <UserAvatar name={u.name} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {u.name} {u.disabled && <Badge variant="outline" className="ml-1 text-[10px]">Deactivated</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                  {u.department || '—'}{u.title ? <span className="block text-xs">{u.title}</span> : null}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${roleColors[u.role]}`}>{roleLabel(u.role)}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
                  {u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`user-actions-${u.user_id}`} aria-label={`Actions for ${u.name}`}>
                        <MoreHorizontal size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(u)} data-testid={`edit-user-${u.user_id}`}>
                        <Edit2 size={13} className="mr-2" /> Edit role & details
                      </DropdownMenuItem>
                      {u.user_id !== currentUser.user_id && (
                        <>
                          <DropdownMenuItem onClick={() => toggleDisabled(u)}>
                            {u.disabled ? <><UserCheck size={13} className="mr-2" /> Reactivate</> : <><UserX size={13} className="mr-2" /> Deactivate</>}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDelete(u)} className="text-destructive" data-testid={`delete-user-${u.user_id}`}>
                            <Trash2 size={13} className="mr-2" /> Delete permanently
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Edit {editUser?.name}</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                <SelectTrigger data-testid="edit-role-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={editForm.department || ''} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Job title</Label>
                <Input value={editForm.title || ''} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
              </div>
            </div>
            {editUser?.user_id !== currentUser.user_id && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><KeyRound size={12} /> Reset password (optional)</Label>
                <Input type="text" placeholder="Leave blank to keep current" minLength={8} value={editForm.password || ''}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} />
              </div>
            )}
            <Button onClick={saveEdit} className="w-full" disabled={saving} data-testid="save-role-btn">
              {saving && <Loader2 size={14} className="animate-spin mr-1" />} Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Add user</DialogTitle>
            <DialogDescription>Create an account with a temporary password. They can change it in Settings.</DialogDescription>
          </DialogHeader>
          <form onSubmit={sendInvite} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Full name</Label>
                <Input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} required data-testid="invite-name" />
              </div>
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Email</Label>
                <Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required data-testid="invite-email" />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={invite.role} onValueChange={(v) => setInvite({ ...invite, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={invite.department} onChange={(e) => setInvite({ ...invite, department: e.target.value })} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Temporary password</Label>
                <div className="flex gap-2">
                  <Input value={invite.password} minLength={8} onChange={(e) => setInvite({ ...invite, password: e.target.value })} required className="font-mono" />
                  <Button type="button" variant="outline" onClick={() => setInvite({ ...invite, password: tempPassword() })}>Generate</Button>
                </div>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={saving} data-testid="invite-submit">
              {saving && <Loader2 size={14} className="animate-spin mr-1" />} Create account
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
