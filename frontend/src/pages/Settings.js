import React, { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { usersApi, errorMessage } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { User, Mail, Shield, Save, KeyRound, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { UserAvatar } from '../components/common';
import { roleLabel } from '../lib/constants';

export default function Settings() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [title, setTitle] = useState(user?.title || '');
  const [capacity, setCapacity] = useState(user?.weekly_capacity_hours ?? 40);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await usersApi.update(user.user_id, {
        name, department, title,
        weekly_capacity_hours: capacity === '' ? null : Number(capacity),
      });
      updateUser(res.data);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update profile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      await usersApi.update(user.user_id, { password: newPassword, current_password: currentPassword });
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not change password'));
    } finally {
      setSavingPassword(false);
    }
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
            <UserAvatar name={user?.name} className="h-16 w-16 border-2 border-primary/30" textClass="text-lg" />
            <div>
              <p className="text-lg font-semibold">{user?.name}</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail size={12} /> {user?.email}
              </div>
              <Badge variant="outline" className="mt-1"><Shield size={10} className="mr-1" /> {roleLabel(user?.role)}</Badge>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} required data-testid="settings-name-input" />
              </div>
              <div className="space-y-2">
                <Label>Job title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Senior Designer" />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Engineering" data-testid="settings-dept-input" />
              </div>
              <div className="space-y-2">
                <Label>Weekly capacity (hours)</Label>
                <Input type="number" min="0" max="168" value={capacity} onChange={e => setCapacity(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Capacity is used to flag overload on the workload view.</p>
            <Button type="submit" disabled={savingProfile} className="gap-1" data-testid="settings-save-btn">
              {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
            </Button>
          </form>
        </CardContent>
      </Card>

      {user?.has_password !== false && (
        <Card className="bg-card/70 border-border/40">
          <CardHeader>
            <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><KeyRound size={16} /> Password</CardTitle>
            <CardDescription>Use at least 8 characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="space-y-4">
              <div className="space-y-2">
                <Label>Current password</Label>
                <Input type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>New password</Label>
                  <Input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} required data-testid="settings-password-input" />
                </div>
                <div className="space-y-2">
                  <Label>Confirm new password</Label>
                  <Input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                </div>
              </div>
              <Button type="submit" variant="secondary" disabled={savingPassword}>
                {savingPassword && <Loader2 size={14} className="animate-spin mr-1" />} Change password
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
