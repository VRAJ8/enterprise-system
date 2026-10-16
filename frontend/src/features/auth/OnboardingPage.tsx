import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage, unwrap } from '@/api/client'
import { useAuth } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthLayout } from './AuthLayout'
import { FormError } from './LoginPage'

/** Shown to signed-in users who don't belong to any workspace (e.g. after leaving one). */
export default function OnboardingPage() {
  const { reloadMe, logout, me } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const ws = await unwrap(api.POST('/api/v1/workspaces', { body: { name } }))
      await reloadMe()
      navigate(`/${ws.slug}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight">Create a workspace</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {me?.name ? `Hi ${me.name.split(' ')[0]} — ` : ''}you're not part of a workspace yet. Create one, or ask a teammate
        for an invitation.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <FormError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="ws">Workspace name</Label>
          <Input id="ws" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." className="h-10" />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          Create workspace
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void logout()}>
          Sign out
        </Button>
      </form>
    </AuthLayout>
  )
}
