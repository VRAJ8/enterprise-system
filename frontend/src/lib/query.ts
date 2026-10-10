import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError
    mutationMeta: {
      /** Suppress the automatic error toast (the caller handles errors itself). */
      silent?: boolean
      /** Prefix for the error toast, e.g. "Couldn't move task". */
      errorTitle?: string
    }
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Background refetch failures of already-loaded data: tell the user once, quietly.
      if (query.state.data !== undefined && !(error instanceof ApiError && error.status === 404)) {
        toast.error(errorMessage(error), { id: `q-${query.queryHash}` })
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return
      const title = mutation.meta?.errorTitle
      toast.error(title ?? errorMessage(error), title ? { description: errorMessage(error) } : undefined)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 2
      },
    },
    mutations: { retry: false },
  },
})
