import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/app/auth'
import { router } from '@/app/router'
import { useUI } from '@/app/ui-store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryClient } from '@/lib/query'
import '@/styles/globals.css'

function ThemedToaster() {
  const theme = useUI((s) => s.theme)
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: '!rounded-lg !border-border !bg-popover !text-popover-foreground !shadow-elev-3 !text-sm',
          description: '!text-muted-foreground',
          actionButton: '!bg-primary !text-primary-foreground',
        },
      }}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={350}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
        <ThemedToaster />
      </TooltipProvider>
      {import.meta.env.DEV && localStorage.getItem('ph-devtools') && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  </StrictMode>,
)
