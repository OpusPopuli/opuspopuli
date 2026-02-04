import { act, renderHook } from "@testing-library/react";
import { OnboardingProvider, useOnboarding } from "@/lib/onboarding-context";
import "@testing-library/jest-dom";

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
  });

  describe("initial state", () => {
    it("should provide onboarding context", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      expect(result.current.hasCompletedOnboarding).toBe(false);
      expect(result.current.currentStep).toBe(0);
      expect(result.current.totalSteps).toBe(4);
    });

    it("should return completed when localStorage flag is set", () => {
      localStorageMock.setItem("opus_onboarding_completed", "true");

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
        result.current.nextStep();
        result.current.nextStep();
        result.current.nextStep();
        result.current.nextStep(); // Already at last step (3)
        result.current.nextStep(); // Should not go beyond 3
      });

      expect(result.current.currentStep).toBe(3);
    });
  });

  describe("completeOnboarding", () => {
    it("should set localStorage flag on complete", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        result.current.completeOnboarding();
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "opus_onboarding_completed",
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
  });

  describe("skipOnboarding", () => {
    it("should complete onboarding when skipped", () => {
      const { result } = renderHook(() => useOnboarding(), { wrapper });

      act(() => {
        result.current.skipOnboarding();
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "opus_onboarding_completed",
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
        "opus_onboarding_completed",
      );
      expect(result.current.currentStep).toBe(0);
      expect(result.current.hasCompletedOnboarding).toBe(false);
    });
  });
});
