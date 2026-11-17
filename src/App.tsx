// NOTE: This file should normally not be modified unless you are adding a new provider.
// To add new routes, edit the AppRouter.tsx file.

import { QueryClientProvider } from "@tanstack/react-query";
import { createAppQueryClient } from "@/lib/query-client";
import { createHead, UnheadProvider } from '@unhead/react/client';
import { InferSeoMetaPlugin } from 'unhead/plugins';
import { Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from '@/components/AppProvider';
import { AppConfig } from '@/contexts/AppContext';
import { APP_RELAYS } from '@/lib/appRelays';
import AppRouter from './AppRouter';

const head = createHead({
  plugins: [
    InferSeoMetaPlugin(),
  ],
});

const queryClient = createAppQueryClient();

const defaultConfig: AppConfig = {
  theme: "dark",
  relayMetadata: APP_RELAYS,
  blossomServerMetadata: {
    servers: [
      'https://blossom.ditto.pub/',
      'https://blossom.dreamith.to/',
      'https://blossom.primal.net/',
    ],
    updatedAt: 0,
  },
  useAppBlossomServers: true,
};

export function App() {
  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey="nostr:app-config" defaultConfig={defaultConfig}>
        <QueryClientProvider client={queryClient}>
          {/* The Nostr provider stack (NostrLoginProvider/NostrProvider/
              NostrSync) is lazy-loaded per-route via NostrShell in AppRouter,
              so the terminal never downloads the Nostr relay stack. */}
          <TooltipProvider>
            <Toaster />
            <Suspense>
              <AppRouter />
            </Suspense>
          </TooltipProvider>
        </QueryClientProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

export default App;
