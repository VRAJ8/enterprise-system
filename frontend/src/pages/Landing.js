import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authApi, errorMessage } from '../lib/api';
import { homeFor } from '../lib/constants';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { FolderKanban, ArrowRight, Users, BarChart3, Shield, Inbox, Loader2 } from 'lucide-react';

export default function Landing() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState({ needs_setup: false, open_registration: true, google_auth: false });
  const [tab, setTab] = useState('login');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  useEffect(() => {
    authApi.config()
      .then((r) => {
        setConfig(r.data);
        if (r.data.needs_setup) setTab('register');
      })
      .catch(() => {});
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login({ email: loginEmail, password: loginPassword });
      login(res.data.access_token, res.data.user);
      navigate(homeFor(res.data.user));
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.register({ name: regName, email: regEmail, password: regPassword });
      login(res.data.access_token, res.data.user);
      navigate(homeFor(res.data.user));
    } catch (err) {
      setError(errorMessage(err, 'Registration failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    const redirectUrl = window.location.origin + '/dashboard';
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const features = [
    { icon: Inbox, title: 'Personal work queue', desc: 'Everyone knows what is overdue, due today and next' },
    { icon: BarChart3, title: 'Portfolio health', desc: 'Spot at-risk projects before deadlines slip' },
    { icon: Users, title: 'Workload & capacity', desc: 'Balance assignments across the team' },
    { icon: Shield, title: 'Role-based access', desc: 'People only see the projects they belong to' },
  ];

  const showRegister = config.open_registration;

  return (
    <div className="min-h-screen bg-background noise-bg relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)' }} />

      <div className="relative z-10 min-h-screen flex">
        <div className="hidden lg:flex flex-1 flex-col justify-center px-16 xl:px-24">
          <div className="animate-fade-in">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center pulse-glow">
                <FolderKanban size={24} className="text-white" />
              </div>
              <span className="text-2xl font-bold font-['Outfit'] tracking-tight">ProjectHub</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-['Outfit'] tracking-tight leading-tight mb-6">
              Deliver projects
              <span className="block text-primary">on time.</span>
            </h1>

            <p className="text-base lg:text-lg text-muted-foreground max-w-md mb-12 leading-relaxed">
              Plan work, assign clear owners and deadlines, and see which projects need attention, all in one place.
            </p>

            <div className="grid grid-cols-2 gap-4 max-w-xl">
              {features.map((f, i) => (
                <div key={i} className="glass-card rounded-lg p-4 animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
                  <f.icon size={20} className="text-primary mb-2" />
                  <p className="text-sm font-semibold mb-1">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 lg:max-w-lg flex items-center justify-center p-6 lg:p-12">
          <Card className="w-full max-w-md bg-card/80 backdrop-blur-xl border-border/40 animate-fade-in" data-testid="auth-card">
            <CardHeader className="text-center pb-2">
              <div className="flex items-center justify-center gap-2 mb-2 lg:hidden">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <FolderKanban size={16} className="text-white" />
                </div>
                <span className="font-bold font-['Outfit']">ProjectHub</span>
              </div>
              <CardTitle className="text-xl font-['Outfit']">
                {config.needs_setup ? 'Set up your workspace' : 'Welcome back'}
              </CardTitle>
              <CardDescription>
                {config.needs_setup
                  ? 'Create the first account. It becomes the workspace administrator.'
                  : 'Sign in to continue'}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {error && (
                <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm" role="alert" data-testid="auth-error">
                  {error}
                </div>
              )}

              {config.google_auth && !config.needs_setup && (
                <>
                  <Button variant="outline" className="w-full mb-4 h-11 gap-2 border-border/60 hover:bg-secondary"
                    onClick={handleGoogleLogin} data-testid="google-login-btn">
                    Continue with Google
                  </Button>
                  <div className="relative mb-4">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/40"></div></div>
                    <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or</span></div>
                  </div>
                </>
              )}

              <Tabs value={tab} onValueChange={(v) => { setTab(v); setError(''); }} className="w-full">
                {showRegister && !config.needs_setup && (
                  <TabsList className="grid w-full grid-cols-2 mb-4 bg-secondary/50">
                    <TabsTrigger value="login" data-testid="login-tab">Sign In</TabsTrigger>
                    <TabsTrigger value="register" data-testid="register-tab">Create account</TabsTrigger>
                  </TabsList>
                )}

                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input id="login-email" type="email" autoComplete="email" placeholder="you@company.com" value={loginEmail}
                        onChange={e => setLoginEmail(e.target.value)} required data-testid="login-email-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <Input id="login-password" type="password" autoComplete="current-password" placeholder="Enter password" value={loginPassword}
                        onChange={e => setLoginPassword(e.target.value)} required data-testid="login-password-input" />
                    </div>
                    <Button type="submit" className="w-full h-11" disabled={loading} data-testid="login-submit-btn">
                      {loading ? <Loader2 size={16} className="animate-spin" /> : <>Sign In <ArrowRight size={16} className="ml-1" /></>}
                    </Button>
                    {!showRegister && (
                      <p className="text-xs text-center text-muted-foreground">Need an account? Ask your workspace administrator for an invite.</p>
                    )}
                  </form>
                </TabsContent>

                <TabsContent value="register">
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reg-name">Full name</Label>
                      <Input id="reg-name" autoComplete="name" placeholder="Jane Doe" value={regName}
                        onChange={e => setRegName(e.target.value)} required data-testid="register-name-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-email">Work email</Label>
                      <Input id="reg-email" type="email" autoComplete="email" placeholder="you@company.com" value={regEmail}
                        onChange={e => setRegEmail(e.target.value)} required data-testid="register-email-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-password">Password</Label>
                      <Input id="reg-password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} value={regPassword}
                        onChange={e => setRegPassword(e.target.value)} required data-testid="register-password-input" />
                    </div>
                    {!config.needs_setup && (
                      <p className="text-xs text-muted-foreground">New accounts join as team members. An admin can change your role.</p>
                    )}
                    <Button type="submit" className="w-full h-11" disabled={loading} data-testid="register-submit-btn">
                      {loading ? <Loader2 size={16} className="animate-spin" /> : <>{config.needs_setup ? 'Create workspace' : 'Create account'} <ArrowRight size={16} className="ml-1" /></>}
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
