import { useQuery } from '@tanstack/react-query'
import { MailCheck, ShieldAlert } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage, unwrap } from '@/api/client'
import { useAuth } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthLayout } from './AuthLayout'
import { FormError } from './LoginPage'

export default function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { status, me, register, reloadMe, logout } = useAuth()
  const lookup = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => unwrap(api.GET('/api/v1/invitations/lookup', { params: { query: { token } } })),
  })
  const [name, setName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const inv = lookup.data
  const invalid = lookup.isError || inv?.expired || inv?.accepted

  const accept = async () => {
    setPending(true)
    setError(null)
    try {
      const ws = await unwrap(api.POST('/api/v1/invitations/accept', { body: { token } }))
      await reloadMe()
      navigate(`/${ws.slug}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inv) return
    setPending(true)
    setError(null)
    try {
      const user = await register({ name, email: inv.email, password, invite_token: token })
      navigate(`/${user.workspaces[0].workspace_slug}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      {lookup.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : invalid ? (
        <div>
          <ShieldAlert className="size-8 text-warning" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            {inv?.accepted ? 'Invitation already used' : inv?.expired ? 'Invitation expired' : 'Invitation not found'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Ask a workspace admin to send you a new invitation link.</p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      ) : inv ? (
        <div>
          <MailCheck className="size-8 text-primary" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Join {inv.workspace_name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {inv.inviter_name ? `${inv.inviter_name} invited you` : "You've been invited"} as{' '}
            <span className="font-medium text-foreground">{inv.role}</span>.
          </p>
          <div className="mt-8 space-y-4">
            <FormError message={error} />
            {status === 'authenticated' && me ? (
              me.email.toLowerCase() === inv.email.toLowerCase() ? (
                <Button size="lg" className="w-full" onClick={accept} loading={pending}>
                  Accept invitation
                </Button>
              ) : (
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    This invitation is for <span className="font-medium text-foreground">{inv.email}</span>, but you're signed
                    in as {me.email}.
                  </p>
                  <Button variant="outline" onClick={() => void logout()}>
                    Sign out and switch account
                  </Button>
                </div>
              )
            ) : inv.account_exists ? (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  You already have an account for <span className="font-medium text-foreground">{inv.email}</span>.
                </p>
                <Button asChild size="lg" className="w-full">
                  <Link to="/login" state={{ from: `/invite/${token}` }}>
                    Sign in to accept
                  </Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={signUp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={inv.email} disabled className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Your name</Label>
                  <Input id="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Choose a password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10"
                  />
                </div>
                <Button type="submit" size="lg" className="w-full" loading={pending}>
                  Join {inv.workspace_name}
                </Button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </AuthLayout>
  )
}
