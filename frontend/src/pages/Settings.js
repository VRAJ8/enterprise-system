import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usersApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { User, Mail, Shield, Save } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Settings() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    try {
      const data = { name, department };
      if (newPassword) data.password = newPassword;
      const res = await usersApi.update(user.user_id, data);
      updateUser(res.data);
      setSuccess('Profile updated');
      setNewPassword('');
    } catch {} finally { setSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl space-y-6" data-testid="settings-page">
      <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">Settings</h2>

      <Card className="bg-card/70 border-border/40">
        <CardHeader>
          <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><User size={16} /> Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-6">
            <Avatar className="h-16 w-16 border-2 border-primary/30">
              <AvatarFallback className="bg-primary/20 text-primary text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-lg font-semibold">{user?.name}</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail size={12} /> {user?.email}
              </div>
              <Badge variant="outline" className="mt-1 capitalize"><Shield size={10} className="mr-1" /> {user?.role?.replace('_', ' ')}</Badge>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} data-testid="settings-name-input" />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Engineering" data-testid="settings-dept-input" />
            </div>
            <div className="space-y-2">
              <Label>New Password (leave empty to keep current)</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" data-testid="settings-password-input" />
            </div>
            {success && <p className="text-sm text-emerald-400" data-testid="settings-success">{success}</p>}
            <Button type="submit" disabled={saving} className="bg-primary gap-1" data-testid="settings-save-btn">
              <Save size={14} /> {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
