import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usersApi } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '../components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '../components/ui/dialog';
import { Search, Users, Shield, Trash2, Edit2 } from 'lucide-react';
import { motion } from 'framer-motion';

const roleColors = {
  admin: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  project_manager: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  team_member: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
};

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [editRole, setEditRole] = useState('');

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try {
      const res = await usersApi.list();
      setUsers(res.data);
    } catch {} finally { setLoading(false); }
  };

  const handleRoleChange = async () => {
    if (!editUser) return;
    try {
      await usersApi.update(editUser.user_id, { role: editRole });
      setEditUser(null);
      loadUsers();
    } catch {}
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this user? This action cannot be undone.')) return;
    try { await usersApi.delete(id); loadUsers(); } catch {}
  };

  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

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
          <p className="text-sm text-muted-foreground">{users.length} total users</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9" data-testid="user-search" />
        </div>
      </div>

      {/* Role stats */}
      <div className="grid grid-cols-3 gap-3">
        {['admin', 'project_manager', 'team_member'].map(role => {
          const count = users.filter(u => u.role === role).length;
          return (
            <Card key={role} className="bg-card/50 border-border/30">
              <CardContent className="p-3 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${role === 'admin' ? 'bg-indigo-400' : role === 'project_manager' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                <span className="text-xs capitalize text-muted-foreground">{role.replace('_', ' ')}s</span>
                <span className="text-sm font-bold ml-auto">{count}</span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Users table */}
      <Card className="bg-card/70 border-border/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/40 hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No users found</TableCell></TableRow>
            ) : filtered.map(u => (
              <TableRow key={u.user_id} className="border-border/30" data-testid={`user-row-${u.user_id}`}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
                        {u.name?.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{u.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`capitalize text-xs ${roleColors[u.role]}`}>
                    {u.role?.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => { setEditUser(u); setEditRole(u.role); }}
                      data-testid={`edit-user-${u.user_id}`}>
                      <Edit2 size={12} />
                    </Button>
                    {u.user_id !== currentUser.user_id && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                        onClick={() => handleDelete(u.user_id)}
                        data-testid={`delete-user-${u.user_id}`}>
                        <Trash2 size={12} />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Edit Role Dialog */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-['Outfit']">Edit User Role</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/20 text-primary">
                  {editUser?.name?.split(' ').map(n => n[0]).join('')}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{editUser?.name}</p>
                <p className="text-sm text-muted-foreground">{editUser?.email}</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger data-testid="edit-role-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                  <SelectItem value="team_member">Team Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleRoleChange} className="w-full bg-primary" data-testid="save-role-btn">Save Role</Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
