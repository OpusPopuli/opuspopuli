import { act, renderHook } from "@testing-library/react";
import { OnboardingProvider, useOnboarding } from "@/lib/onboarding-context";
import "@testing-library/jest-dom";

// The provider persists completion to the server via useMutation (#758).
// Mock the Apollo hook so the context can be exercised without an
// ApolloProvider, and so we can assert the mutation fires on complete.
const mockPersistOnboarding = jest.fn().mockResolvedValue({ data: {} });
// `completeOnboarding` also kicks off relevance generation so a new user is
// not left with an empty briefing until the 03:00 cron. The client is mocked
// here rather than asserted on; the priming behaviour has its own tests below.
const mockQuery = jest.fn().mockResolvedValue({ data: null });
const mockMutate = jest.fn().mockResolvedValue({ data: null });

// The provider reads the durable onboarding flag back via useQuery (#758) to
// hydrate the localStorage cache on a fresh device. Tests drive this by
// setting mockUseQueryData before rendering.
let mockUseQueryData: unknown = undefined;

jest.mock("@apollo/client/react", () => ({
  useMutation: () => [mockPersistOnboarding, { loading: false }],
  useApolloClient: () => ({ query: mockQuery, mutate: mockMutate }),
  useQuery: () => ({ data: mockUseQueryData }),
}));

// The provider gates its server read on auth; no ApolloProvider/AuthProvider
// is mounted in these hook tests, so stub the auth context.
let mockIsAuthenticated = false;
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    _getStore: () => store,
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <OnboardingProvider>{children}</OnboardingProvider>
);

describe("OnboardingProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockUseQueryData = undefined;
    mockIsAuthenticated = false;
  });

  describe("server flag hydration (#758)", () => {
    it("hydrates localStorage from the server onboardingCompletedAt", () => {
      // A user who onboarded on another device: localStorage empty here, but
      // the server says they are done.
      mockIsAuthenticated = true;
      mockUseQueryData = {
        myProfile: {
          id: "p1",
          onboardingCompletedAt: "2026-08-20T00:00:00.000Z",
        },
      };

      const { result } = renderHook(() => useOnboarding(), { wrapper });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "opuspopuli_onboarding_completed",
        "true",
      );
      expect(result.current.hasCompletedOnboarding).toBe(true);
    });

    it("does not hydrate when the server flag is null", () => {
      mockIsAuthenticated = true;
      mockUseQueryData = {
        myProfile: { id: "p1", onboardingCompletedAt: null },
      };

      renderHook(() => useOnboarding(), { wrapper });

      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        "opuspopuli_onboarding_completed",
        "true",
      );
    });
  });

  describe("initial state", () => {
    it("should provide onboarding context", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      expect(result.current.hasCompletedOnboarding).toBe(false);
      expect(result.current.currentStep).toBe(0);
      expect(result.current.totalSteps).toBe(6);
    });

    it("should return completed when localStorage flag is set", () => {
      localStorageMock.setItem("opuspopuli_onboarding_completed", "true");

      const { result } = renderHook(() => useOnboarding(), { wrapper });

      expect(result.current.hasCompletedOnboarding).toBe(true);
    });

    it("should throw error when used outside provider", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useOnboarding());
      }).toThrow("useOnboarding must be used within OnboardingProvider");

      consoleError.mockRestore();
    });
  });

  describe("step navigation", () => {
    it("should advance to next step", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        result.current.nextStep();
      });

      expect(result.current.currentStep).toBe(1);
    });

    it("should go back to previous step", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        result.current.nextStep();
        result.current.nextStep();
      });

      expect(result.current.currentStep).toBe(2);

      act(() => {
        result.current.prevStep();
      });

      expect(result.current.currentStep).toBe(1);
    });

    it("should not go below step 0", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        result.current.prevStep();
      });

      expect(result.current.currentStep).toBe(0);
    });

    it("should not exceed totalSteps - 1", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        for (let i = 0; i < 12; i++) {
          result.current.nextStep();
        }
      });

      expect(result.current.currentStep).toBe(5);
    });
  });

  describe("completeOnboarding", () => {
    it("should set localStorage flag on complete", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        result.current.completeOnboarding();
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "opuspopuli_onboarding_completed",
        "true",
      );
    });

    it("should update hasCompletedOnboarding after complete", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      expect(result.current.hasCompletedOnboarding).toBe(false);

      act(() => {
        result.current.completeOnboarding();
      });

      expect(result.current.hasCompletedOnboarding).toBe(true);
    });

    it("should persist completion to the server on complete (#758)", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        result.current.completeOnboarding();
      });

      expect(mockPersistOnboarding).toHaveBeenCalledTimes(1);
    });
  });

  describe("skipOnboarding", () => {
    it("should complete onboarding when skipped", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        result.current.skipOnboarding();
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "opuspopuli_onboarding_completed",
        "true",
      );
      expect(result.current.hasCompletedOnboarding).toBe(true);
    });
  });

  describe("resetOnboarding", () => {
    it("should clear localStorage and reset step", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      // First complete and advance
      act(() => {
        result.current.nextStep();
        result.current.nextStep();
        result.current.completeOnboarding();
      });

      expect(result.current.hasCompletedOnboarding).toBe(true);
      expect(result.current.currentStep).toBe(2);

      // Then reset
      act(() => {
        result.current.resetOnboarding();
      });

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        "opuspopuli_onboarding_completed",
      );
      expect(result.current.currentStep).toBe(0);
      expect(result.current.hasCompletedOnboarding).toBe(false);
    });
  });
  describe("priming personalization on completion", () => {
    /*
     * Nothing used to trigger relevance generation on sign-up -- only the
     * nightly 03:00 cron and a manual mutation. A brand-new user finished
     * onboarding, landed on their briefing, and found the committees section
     * empty with no explanations anywhere until the next morning: the whole
     * point of the product missing on the one visit that forms an impression.
     */
    const FLAGS = {
      __typename: "RankingFlags",
      isRenter: false,
      isHomeowner: true,
      isParent: true,
      isDriver: true,
    };

    beforeEach(() => {
      mockQuery.mockResolvedValue({
        data: {
          myRankingFlags: FLAGS,
          mySignalProfile: { interestTags: ["education", "healthcare"] },
        },
      });
      mockMutate.mockResolvedValue({ data: null });
    });

    const completeVia = async (fn: "completeOnboarding" | "skipOnboarding") => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });
      await act(async () => {
        result.current[fn]();
      });
    };

    it("enqueues a rerank when onboarding completes", async () => {
      await completeVia("completeOnboarding");

      expect(mockMutate).toHaveBeenCalled();
      const vars = mockMutate.mock.calls[0][0].variables;
      expect(vars.input.interestTags).toEqual(["education", "healthcare"]);
      expect(vars.input.flags.isHomeowner).toBe(true);
      expect(vars.input.flags.isParent).toBe(true);
    });

    it("strips __typename from the flags", async () => {
      await completeVia("completeOnboarding");

      // GraphQL input objects reject unknown fields, so leaving Apollo's
      // __typename in fails the whole mutation with a validation error rather
      // than anything that points at the cause.
      const vars = mockMutate.mock.calls[0][0].variables;
      expect(vars.input.flags).not.toHaveProperty("__typename");
    });

    it("reads the flags from the network, not the cache", async () => {
      await completeVia("completeOnboarding");

      // Onboarding wrote the signal profile moments ago; a cached read would
      // personalise using the pre-onboarding flags.
      expect(mockQuery.mock.calls[0][0].fetchPolicy).toBe("network-only");
    });

    it("still records completion when priming fails", async () => {
      mockQuery.mockRejectedValue(new Error("offline"));

      await completeVia("completeOnboarding");

      // Fire-and-forget: a failed prime just means the cron fills the cache
      // tonight, which is the old behaviour. It must never block completion.
      expect(mockPersistOnboarding).toHaveBeenCalled();
      expect(localStorage.getItem("opuspopuli_onboarding_completed")).toBe(
        "true",
      );
    });

    it("primes on skip too", async () => {
      // Skipping still leaves a usable account; the briefing should fill in
      // for them as well.
      await completeVia("skipOnboarding");

      expect(mockMutate).toHaveBeenCalled();
    });
  });
});
