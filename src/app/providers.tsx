'use client';

import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wallet/config';
import { SoundProvider } from '@/lib/audio/SoundProvider';

/**
 * Client providers.
 *
 * The QueryClient is created inside state rather than at module scope on
 * purpose: a module-level client is shared across every request on the server,
 * which leaks one user's cached data into another's render.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Chain state is cheap to re-read and expensive to be wrong about.
            staleTime: 10_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SoundProvider>{children}</SoundProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
