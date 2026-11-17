import { QueryClient } from "@tanstack/react-query";

/** Inactive query results are useful to revisit, but must not live forever. */
export const APP_QUERY_GC_TIME_MS = 5 * 60_000;
export const APP_QUERY_STALE_TIME_MS = 60_000;

/** Shared app defaults: active queries stay live; unused keys are collected. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: APP_QUERY_STALE_TIME_MS,
        gcTime: APP_QUERY_GC_TIME_MS,
      },
    },
  });
}
