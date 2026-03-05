"use client";

import { useQuery } from "@apollo/client/react";
import {
  GET_PETITION_ACTIVITY_FEED,
  PetitionActivityFeedData,
  PetitionActivityFeed,
} from "../graphql/documents";

const POLL_INTERVAL_MS = 30_000;

export interface UseActivityFeedReturn {
  feed: PetitionActivityFeed | null;
  loading: boolean;
  error: Error | null;
}

export function useActivityFeed(): UseActivityFeedReturn {
  const { data, loading, error } = useQuery<PetitionActivityFeedData>(
    GET_PETITION_ACTIVITY_FEED,
    {
      fetchPolicy: "cache-and-network",
      pollInterval: POLL_INTERVAL_MS,
    },
  );

  return {
    feed: data?.petitionActivityFeed ?? null,
    loading,
    error: error ?? null,
  };
}
