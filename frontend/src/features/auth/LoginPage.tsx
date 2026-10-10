import * as React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { errorMessage } from '@/api/client'
import { useAuth } from '@/app/auth'
import { lastWorkspaceSlug } from '@/app/workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthLayout } from './AuthLayout'

export function homePathFor(me: { workspaces: { workspace_slug: string }[] }): string {
  const last = lastWorkspaceSlug()
  const ws = me.workspaces.find((w) => w.workspace_slug === last) ?? me.workspaces[0]
  return ws ? `/${ws.workspace_slug}` : '/onboarding'
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </div>
  )
}

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const me = await login(email, password)
      navigate(from && from !== '/' ? from : homePathFor(me), { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to your workspace.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <FormError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10"
          />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to ProjectHub?{' '}
        <Link to="/signup" className="font-medium text-foreground hover:text-primary">
          Create a workspace
        </Link>
      </p>
    </AuthLayout>
  )
}
