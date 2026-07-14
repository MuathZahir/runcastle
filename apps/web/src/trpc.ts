import { createTRPCReact } from '@trpc/react-query'
// Type-only import of the server's router type. Resolved via the tsconfig
// `paths` mapping to packages/server/src/trpc/router.ts (no build step, no edit
// to packages/server). `import type` is fully erased, so the runtime bundle
// never pulls server code.
import type { AppRouter } from '@runcastle/server'

/** The typed tRPC React hooks (`trpc.feature.get.useQuery`, etc.). */
export const trpc = createTRPCReact<AppRouter>()
