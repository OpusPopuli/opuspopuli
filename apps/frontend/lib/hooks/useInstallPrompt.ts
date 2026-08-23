"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * The event Chromium browsers fire when the app meets the installability
 * criteria (manifest + service worker + HTTPS). It is not in lib.dom, and it
 * does not exist at all on iOS — see `method` below.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

export type InstallMethod = "native" | "ios-share";

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallPrompt {
  /**
   * The app can still be added to a home screen: not already installed, and
   * either the browser handed us a deferred prompt or we are on iOS, where
   * the user does it through the Share sheet. Ignores dismissal — a surface
   * the user opened deliberately (the menu button) should still offer it.
   */
  readonly isInstallable: boolean;
  /** Whether the passive banner was dismissed inside the cool-off window. */
  readonly isDismissed: boolean;
  readonly method: InstallMethod | null;
  install: () => Promise<InstallOutcome>;
  dismiss: () => void;
}

const DISMISSED_AT_KEY = "op-install-prompt-dismissed-at";

/**
 * How long a dismissal suppresses the banner. Long enough that "not now" is
 * respected rather than re-asked next session, short enough that someone who
 * declined before an election cycle is offered it again.
 */
const DISMISS_COOL_OFF_MS = 30 * 24 * 60 * 60 * 1000;

function isRunningStandalone(): boolean {
  // iOS Safari never matches display-mode inside a home-screen app; it sets
  // this non-standard flag instead.
  const iosStandalone = (
    globalThis.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  if (iosStandalone === true) return true;
  return globalThis.matchMedia?.("(display-mode: standalone)").matches === true;
}

function isIosDevice(): boolean {
  const ua = globalThis.navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS 13+ reports a desktop Safari UA; touch points are the giveaway.
  return /macintosh/i.test(ua) && globalThis.navigator.maxTouchPoints > 1;
}

function readDismissedAt(): boolean {
  try {
    const raw = globalThis.localStorage.getItem(DISMISSED_AT_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < DISMISS_COOL_OFF_MS;
  } catch {
    // Safari in private mode throws on localStorage access. A prompt we
    // cannot suppress is better than no prompt at all.
    return false;
  }
}

function writeDismissedAt(): void {
  try {
    globalThis.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
  } catch {
    // See readDismissedAt — dismissal just does not survive the reload.
  }
}

/**
 * A store that never emits. Pairs a `false` server snapshot with a `true`
 * client one, so platform detection can run after hydration without a
 * setState in an effect body.
 */
const subscribeNever = () => () => {};

/**
 * Drives the "add to home screen" affordances.
 *
 * Two very different platforms sit behind one interface:
 *
 *  - Chromium (Android, desktop) fires `beforeinstallprompt`. We call
 *    `preventDefault()` on it to suppress the browser's own mini-infobar and
 *    keep the deferred event, so the install dialog opens from our button,
 *    in our copy, at a moment the user chose.
 *  - iOS/iPadOS has no such event and no programmatic install. The only path
 *    is Share → Add to Home Screen, so there the UI shows instructions.
 *
 * Everything platform-dependent is read behind `isHydrated` rather than
 * during the first render: the server cannot know any of it, and guessing
 * produces a hydration mismatch. Until hydration the hook reports the app as
 * already installed and the prompt as dismissed, so nothing flashes in.
 */
export function useInstallPrompt(): InstallPrompt {
  const isHydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [deferredEvent, setDeferredEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [didInstall, setDidInstall] = useState(false);
  const [didDismiss, setDidDismiss] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDidInstall(true);
      setDeferredEvent(null);
    };

    globalThis.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    globalThis.addEventListener("appinstalled", onAppInstalled);
    return () => {
      globalThis.removeEventListener(
        "beforeinstallprompt",
        onBeforeInstallPrompt,
      );
      globalThis.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    writeDismissedAt();
    setDidDismiss(true);
  }, []);

  const install = useCallback(async (): Promise<InstallOutcome> => {
    if (!deferredEvent) return "unavailable";

    await deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;

    // The event is single-use; Chromium fires a fresh one if the user
    // declines and later becomes eligible again.
    setDeferredEvent(null);
    if (outcome === "dismissed") {
      // They said no to the browser's own dialog. Do not re-ask on the next
      // page view.
      dismiss();
    }
    return outcome;
  }, [deferredEvent, dismiss]);

  const platform = useMemo(
    () =>
      isHydrated
        ? {
            isIos: isIosDevice(),
            isStandalone: isRunningStandalone(),
            wasDismissed: readDismissedAt(),
          }
        : { isIos: false, isStandalone: true, wasDismissed: true },
    [isHydrated],
  );

  let method: InstallMethod | null = null;
  if (deferredEvent) method = "native";
  else if (platform.isIos) method = "ios-share";

  return {
    isInstallable: !didInstall && !platform.isStandalone && method !== null,
    isDismissed: didDismiss || platform.wasDismissed,
    method,
    install,
    dismiss,
  };
}
