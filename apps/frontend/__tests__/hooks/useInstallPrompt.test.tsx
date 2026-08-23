import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/hooks/useInstallPrompt";

const DISMISSED_AT_KEY = "op-install-prompt-dismissed-at";

function setUserAgent(ua: string) {
  Object.defineProperty(globalThis.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

function setMaxTouchPoints(points: number) {
  Object.defineProperty(globalThis.navigator, "maxTouchPoints", {
    value: points,
    configurable: true,
  });
}

function mockDisplayMode(standalone: boolean) {
  globalThis.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof globalThis.matchMedia;
}

function fireBeforeInstallPrompt(
  outcome: "accepted" | "dismissed" = "accepted",
) {
  const prompt = jest.fn().mockResolvedValue(undefined);
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    {
      platforms: ["web"],
      prompt,
      userChoice: Promise.resolve({ outcome, platform: "web" }),
    },
  ) as unknown as BeforeInstallPromptEvent;
  act(() => {
    globalThis.dispatchEvent(event);
  });
  return { event, prompt };
}

const CHROME_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

describe("useInstallPrompt", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    setUserAgent(CHROME_ANDROID_UA);
    setMaxTouchPoints(1);
    mockDisplayMode(false);
  });

  it("is not installable until the browser offers a prompt", () => {
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isInstallable).toBe(false);
    expect(result.current.method).toBeNull();
  });

  it("becomes installable via the native prompt on Chromium", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();

    await waitFor(() => expect(result.current.isInstallable).toBe(true));
    expect(result.current.method).toBe("native");
    expect(result.current.isDismissed).toBe(false);
  });

  it("suppresses the browser's own mini-infobar", () => {
    renderHook(() => useInstallPrompt());
    const { event } = fireBeforeInstallPrompt();

    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the deferred dialog and reports the outcome", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const { prompt } = fireBeforeInstallPrompt("accepted");
    await waitFor(() => expect(result.current.isInstallable).toBe(true));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.install();
    });

    expect(prompt).toHaveBeenCalled();
    expect(outcome).toBe("accepted");
    // The event is single-use, so the affordance retires with it.
    expect(result.current.isInstallable).toBe(false);
  });

  it("does not re-ask after the user declines the browser dialog", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt("dismissed");
    await waitFor(() => expect(result.current.isInstallable).toBe(true));

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.isDismissed).toBe(true);
    expect(globalThis.localStorage.getItem(DISMISSED_AT_KEY)).not.toBeNull();
  });

  it("reports 'unavailable' when install is called with no deferred event", async () => {
    const { result } = renderHook(() => useInstallPrompt());

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.install();
    });

    expect(outcome).toBe("unavailable");
  });

  it("offers the iOS Share recipe, which has no deferred event", async () => {
    setUserAgent(IPHONE_UA);
    const { result } = renderHook(() => useInstallPrompt());

    await waitFor(() => expect(result.current.isInstallable).toBe(true));
    expect(result.current.method).toBe("ios-share");
  });

  it("treats an iPadOS desktop user agent with touch as iOS", async () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
    );
    setMaxTouchPoints(5);
    const { result } = renderHook(() => useInstallPrompt());

    await waitFor(() => expect(result.current.method).toBe("ios-share"));
  });

  it("stays quiet inside a home-screen app (display-mode: standalone)", async () => {
    mockDisplayMode(true);
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();

    await waitFor(() => expect(result.current.method).toBe("native"));
    expect(result.current.isInstallable).toBe(false);
  });

  it("stays quiet inside an iOS home-screen app (navigator.standalone)", async () => {
    setUserAgent(IPHONE_UA);
    Object.defineProperty(globalThis.navigator, "standalone", {
      value: true,
      configurable: true,
    });
    const { result } = renderHook(() => useInstallPrompt());

    await waitFor(() => expect(result.current.method).toBe("ios-share"));
    expect(result.current.isInstallable).toBe(false);

    Object.defineProperty(globalThis.navigator, "standalone", {
      value: undefined,
      configurable: true,
    });
  });

  it("retires once the app reports itself installed", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();
    await waitFor(() => expect(result.current.isInstallable).toBe(true));

    act(() => {
      globalThis.dispatchEvent(new Event("appinstalled"));
    });

    await waitFor(() => expect(result.current.isInstallable).toBe(false));
  });

  it("remembers a dismissal", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();
    await waitFor(() => expect(result.current.isInstallable).toBe(true));

    act(() => result.current.dismiss());

    expect(result.current.isDismissed).toBe(true);
    expect(globalThis.localStorage.getItem(DISMISSED_AT_KEY)).not.toBeNull();
  });

  it("honours a dismissal inside the cool-off window", async () => {
    globalThis.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();

    await waitFor(() => expect(result.current.isInstallable).toBe(true));
    expect(result.current.isDismissed).toBe(true);
  });

  it("asks again once the cool-off window has passed", async () => {
    const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60 * 1000;
    globalThis.localStorage.setItem(
      DISMISSED_AT_KEY,
      String(Date.now() - THIRTY_ONE_DAYS),
    );
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();

    await waitFor(() => expect(result.current.isInstallable).toBe(true));
    expect(result.current.isDismissed).toBe(false);
  });

  it("still offers the prompt when localStorage is unavailable", async () => {
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("private mode");
      });
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("private mode");
      });

    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();

    await waitFor(() => expect(result.current.isInstallable).toBe(true));
    expect(result.current.isDismissed).toBe(false);
    act(() => result.current.dismiss());
    expect(result.current.isDismissed).toBe(true);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
