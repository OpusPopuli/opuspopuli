"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { buttonVariants } from "@/components/ui/Button";

/** Where the prompt sits; each says what an account adds on that page. */
export type AccountPromptKind = "proposition" | "representative" | "bill";

const DISMISSED_KEY = "op-account-prompt-dismissed-v1";

function readDismissed(): string {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) ?? "";
  } catch {
    return "";
  }
}

function isDismissed(raw: string, kind: AccountPromptKind): boolean {
  return raw.split(",").includes(kind);
}

function rememberDismissed(kind: AccountPromptKind): void {
  try {
    const kinds = new Set(readDismissed().split(",").filter(Boolean));
    kinds.add(kind);
    globalThis.localStorage?.setItem(
      DISMISSED_KEY,
      Array.from(kinds).join(","),
    );
  } catch {
    // Storage refused: the prompt stays dismissed for this page view only.
  }
}

const noSubscription = () => () => {};
/** Hidden on the server and while hydrating: nothing to mismatch. */
const serverSnapshot = () => null;

/**
 * An invitation, never a wall (#1456).
 *
 * Shown to a visitor without an account, on the pages where an account adds
 * something: what a proposition means to them, and following a
 * representative or a bill in their briefing. Inline and dismissible, and
 * dismissing one kind is remembered on the device, so a reader who said no
 * isn't asked again on every page of that kind. Signed in, it renders
 * nothing.
 */
export function AccountPrompt({ kind }: { readonly kind: AccountPromptKind }) {
  const { t } = useTranslation("region");
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const stored = useSyncExternalStore(
    noSubscription,
    readDismissed,
    serverSnapshot,
  );
  const [dismissedNow, setDismissedNow] = useState(false);

  if (isLoading || isAuthenticated) return null;
  if (stored === null || isDismissed(stored, kind) || dismissedNow) {
    return null;
  }

  // Back to this page after signing in, as ProtectedRoute does. Sign-up
  // goes through onboarding, which doesn't take a return path.
  const back = `?redirect=${encodeURIComponent(pathname ?? "/region")}`;
  const titleId = `account-prompt-${kind}`;

  return (
    <aside
      aria-labelledby={titleId}
      className="my-6 rounded-lg border border-line bg-surface-alt p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={titleId} className="font-semibold text-content">
            {t(`accountPrompt.${kind}.title`)}
          </h2>
          <p className="mt-1 text-sm text-content-dim">
            {t(`accountPrompt.${kind}.body`)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            rememberDismissed(kind);
            setDismissedNow(true);
          }}
          aria-label={t("accountPrompt.dismiss")}
          className="shrink-0 rounded p-1 text-content-dim hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Link
          href="/register"
          className={buttonVariants({ variant: "gold", size: "sm" })}
        >
          {t("accountPrompt.create")}
        </Link>
        <Link
          href={`/login${back}`}
          prefetch={false}
          className="text-content underline decoration-line underline-offset-2 hover:decoration-accent"
        >
          {t("accountPrompt.signIn")}
        </Link>
      </div>
    </aside>
  );
}
