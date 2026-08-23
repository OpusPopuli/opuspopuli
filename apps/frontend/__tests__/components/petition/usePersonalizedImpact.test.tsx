/**
 * Hook tests for usePersonalizedImpact (#1052).
 *
 * The wire contract IS the privacy boundary here: the mutation variables
 * must contain exactly {documentId, interestTags, rankingFlags,
 * regionLabel} — never a postal code, coordinates, or raw address — and
 * the failure path must degrade to "absent" (generic analysis fallback)
 * without throwing into the page.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { usePersonalizedImpact } from "@/components/petition/usePersonalizedImpact";
import { GET_BRIEFING_PREFETCH } from "@/lib/graphql/personalized-feed";
import { GET_MY_ADDRESSES } from "@/lib/graphql/profile";

const mockGenerate = jest.fn();

let prefetchResult: { data?: unknown; loading: boolean } = {
  data: undefined,
  loading: false,
};
let addressesResult: { data?: unknown; loading: boolean } = {
  data: undefined,
  loading: false,
};

jest.mock("@apollo/client/react", () => ({
  useQuery: (query: unknown, opts?: { skip?: boolean }) =>
    mockUseQuery(query, opts),
  useMutation: () => [mockGenerate],
}));

function mockUseQuery(query: unknown, opts?: { skip?: boolean }) {
  if (opts?.skip) return { data: undefined, loading: false };
  if (query === GET_BRIEFING_PREFETCH) return prefetchResult;
  if (query === GET_MY_ADDRESSES) return addressesResult;
  throw new Error("Unexpected query in usePersonalizedImpact test");
}

let mockAuth = { isAuthenticated: true, isLoading: false };
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => mockAuth,
}));

const FLAGS = {
  __typename: "RankingFlags",
  isRenter: true,
  isVeteran: false,
  isParent: false,
};

function declareProfile(interestTags: string[], postalCode?: string) {
  prefetchResult = {
    loading: false,
    data: {
      myRankingFlags: FLAGS,
      mySignalProfile: { interestTags },
    },
  };
  addressesResult = {
    loading: false,
    data: {
      myAddresses: postalCode
        ? [
            {
              id: "addr-1",
              isPrimary: true,
              postalCode,
              addressLine1: "123 Anywhere St",
              latitude: 37.77,
              longitude: -122.42,
            },
          ]
        : [],
    },
  };
}

describe("usePersonalizedImpact", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = { isAuthenticated: true, isLoading: false };
    prefetchResult = { data: undefined, loading: false };
    addressesResult = { data: undefined, loading: false };
    mockGenerate.mockResolvedValue({
      data: { personalizedImpact: { text: "read", fromCache: false } },
    });
  });

  it("sends exactly the declared signals + coarsened label — never the address", async () => {
    // public_safety is canonical vocabulary (underscore!); "Bad Tag!" is a
    // lenient legacy value that must be filtered, not fail the request.
    declareProfile(["housing", "public_safety", "Bad Tag!"], "94110");

    const { result } = renderHook(() => usePersonalizedImpact("doc-1", true));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
    const { input } = mockGenerate.mock.calls[0][0].variables;
    expect(input).toEqual({
      documentId: "doc-1",
      interestTags: ["housing", "public_safety"],
      rankingFlags: ["isRenter"],
      regionLabel: "94xxx",
    });
    // The privacy boundary, stated as data: nothing address-shaped crosses.
    const wire = JSON.stringify(mockGenerate.mock.calls[0][0]);
    expect(wire).not.toContain("94110");
    expect(wire).not.toContain("Anywhere");
    expect(wire).not.toContain("latitude");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.impact?.text).toBe("read");
  });

  it("degrades silently to absent when the mutation fails", async () => {
    declareProfile(["housing"]);
    mockGenerate.mockRejectedValue(new Error("validation failed"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => usePersonalizedImpact("doc-1", true));

    await waitFor(() => expect(result.current.status).toBe("absent"));
    // Silent in the UI, observable in the console.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is absent (not an error) for a profile with no declared signals", async () => {
    declareProfile([]);
    prefetchResult = {
      loading: false,
      data: {
        myRankingFlags: { __typename: "RankingFlags", isRenter: false },
        mySignalProfile: { interestTags: [] },
      },
    };
    const { result } = renderHook(() => usePersonalizedImpact("doc-1", true));

    await waitFor(() => expect(result.current.status).toBe("absent"));
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("reports loading (not the sign-in nudge) while auth is restoring", () => {
    mockAuth = { isAuthenticated: false, isLoading: true };
    const { result } = renderHook(() => usePersonalizedImpact("doc-1", true));
    expect(result.current.status).toBe("loading");
  });

  it("is anonymous once auth resolves signed-out", () => {
    mockAuth = { isAuthenticated: false, isLoading: false };
    const { result } = renderHook(() => usePersonalizedImpact("doc-1", true));
    expect(result.current.status).toBe("anonymous");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("does not generate until the analysis completes", async () => {
    declareProfile(["housing"]);
    const { result, rerender } = renderHook(
      ({ complete }: { complete: boolean }) =>
        usePersonalizedImpact("doc-1", complete),
      { initialProps: { complete: false } },
    );

    expect(result.current.status).toBe("loading");
    expect(mockGenerate).not.toHaveBeenCalled();

    rerender({ complete: true });
    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
  });

  it("resets and regenerates for a new document in the same mount", async () => {
    declareProfile(["housing"]);
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => usePersonalizedImpact(id, true),
      { initialProps: { id: "doc-1" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    mockGenerate.mockResolvedValue({
      data: { personalizedImpact: { text: "second read", fromCache: false } },
    });
    rerender({ id: "doc-2" });

    // Never serve doc-1's read while doc-2 is generating.
    await waitFor(() =>
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({
            input: expect.objectContaining({ documentId: "doc-2" }),
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.impact?.text).toBe("second read"),
    );
  });
});
