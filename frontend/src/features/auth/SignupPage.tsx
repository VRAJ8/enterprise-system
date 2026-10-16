import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessage } from '@/api/client'
import { useAuth } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthLayout } from './AuthLayout'
import { FormError } from './LoginPage'

export default function SignupPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = React.useState({ name: '', email: '', password: '', workspace_name: '' })
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const me = await register(form)
      navigate(`/${me.workspaces[0].workspace_slug}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-1 text-sm text-muted-foreground">Free to start. Invite your team in a minute.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <FormError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" autoComplete="name" required autoFocus value={form.name} onChange={set('name')} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
            placeholder="you@company.com"
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={set('password')}
            placeholder="At least 8 characters"
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workspace">Workspace name</Label>
          <Input
            id="workspace"
            required
            value={form.workspace_name}
            onChange={set('workspace_name')}
            placeholder="Acme Inc."
            className="h-10"
          />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          Create workspace
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-foreground hover:text-primary">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
