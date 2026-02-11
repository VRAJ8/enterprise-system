import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { FolderKanban, ArrowRight, Users, BarChart3, MessageSquare, Shield } from 'lucide-react';

export default function Landing() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState('team_member');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login({ email: loginEmail, password: loginPassword });
      login(res.data.access_token, res.data.user);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.register({ name: regName, email: regEmail, password: regPassword, role: regRole });
      login(res.data.access_token, res.data.user);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + '/dashboard';
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const features = [
    { icon: FolderKanban, title: 'Project Management', desc: 'Plan, track, and deliver projects on time' },
    { icon: Users, title: 'Team Collaboration', desc: 'Real-time chat and seamless teamwork' },
    { icon: BarChart3, title: 'Analytics Dashboard', desc: 'Visual insights into project performance' },
    { icon: Shield, title: 'Role-Based Access', desc: 'Secure access control for every team role' },
  ];

  return (
    <div className="min-h-screen bg-background noise-bg relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)' }} />

      <div className="relative z-10 min-h-screen flex">
        {/* Left side - Branding */}
        <div className="hidden lg:flex flex-1 flex-col justify-center px-16 xl:px-24">
          <div className="animate-fade-in">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center pulse-glow">
                <FolderKanban size={24} className="text-white" />
              </div>
              <span className="text-2xl font-bold font-['Outfit'] tracking-tight">ProjectHub</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-['Outfit'] tracking-tight leading-tight mb-6">
              Enterprise Project
              <span className="block text-primary">Management</span>
            </h1>

            <p className="text-base lg:text-lg text-muted-foreground max-w-md mb-12 leading-relaxed">
              Centralized platform to plan, manage, track, and collaborate on projects efficiently with role-based access and real-time communication.
            </p>

            <div className="grid grid-cols-2 gap-4">
              {features.map((f, i) => (
                <div
                  key={i}
                  className="glass-card rounded-lg p-4 animate-fade-in"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <f.icon size={20} className="text-primary mb-2" />
                  <p className="text-sm font-semibold mb-1">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right side - Auth Form */}
        <div className="flex-1 lg:max-w-lg flex items-center justify-center p-6 lg:p-12">
          <Card className="w-full max-w-md bg-card/80 backdrop-blur-xl border-border/40 animate-fade-in" data-testid="auth-card">
            <CardHeader className="text-center pb-2">
              <div className="flex items-center justify-center gap-2 mb-2 lg:hidden">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <FolderKanban size={16} className="text-white" />
                </div>
                <span className="font-bold font-['Outfit']">ProjectHub</span>
              </div>
              <CardTitle className="text-xl font-['Outfit']">Welcome</CardTitle>
              <CardDescription>Sign in or create an account to get started</CardDescription>
            </CardHeader>

            <CardContent>
              {error && (
                <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm" data-testid="auth-error">
                  {error}
                </div>
              )}

              <Button
                variant="outline"
                className="w-full mb-4 h-11 gap-2 border-border/60 hover:bg-secondary"
                onClick={handleGoogleLogin}
                data-testid="google-login-btn"
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </Button>

              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/40"></div></div>
                <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or</span></div>
              </div>

              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4 bg-secondary/50">
                  <TabsTrigger value="login" data-testid="login-tab">Sign In</TabsTrigger>
                  <TabsTrigger value="register" data-testid="register-tab">Register</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input id="login-email" type="email" placeholder="you@company.com" value={loginEmail}
                        onChange={e => setLoginEmail(e.target.value)} required data-testid="login-email-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <Input id="login-password" type="password" placeholder="Enter password" value={loginPassword}
                        onChange={e => setLoginPassword(e.target.value)} required data-testid="login-password-input" />
                    </div>
                    <Button type="submit" className="w-full h-11 bg-primary hover:bg-primary/90 shadow-[0_0_15px_rgba(99,102,241,0.4)]"
                      disabled={loading} data-testid="login-submit-btn">
                      {loading ? 'Signing in...' : 'Sign In'} <ArrowRight size={16} className="ml-1" />
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="register">
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reg-name">Full Name</Label>
                      <Input id="reg-name" placeholder="John Doe" value={regName}
                        onChange={e => setRegName(e.target.value)} required data-testid="register-name-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-email">Email</Label>
                      <Input id="reg-email" type="email" placeholder="you@company.com" value={regEmail}
                        onChange={e => setRegEmail(e.target.value)} required data-testid="register-email-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-password">Password</Label>
                      <Input id="reg-password" type="password" placeholder="Min 6 characters" value={regPassword}
                        onChange={e => setRegPassword(e.target.value)} required data-testid="register-password-input" />
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={regRole} onValueChange={setRegRole}>
                        <SelectTrigger data-testid="register-role-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="project_manager">Project Manager</SelectItem>
                          <SelectItem value="team_member">Team Member</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" className="w-full h-11 bg-primary hover:bg-primary/90 shadow-[0_0_15px_rgba(99,102,241,0.4)]"
                      disabled={loading} data-testid="register-submit-btn">
                      {loading ? 'Creating account...' : 'Create Account'} <ArrowRight size={16} className="ml-1" />
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
