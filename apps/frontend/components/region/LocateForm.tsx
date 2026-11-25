"use client";

import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { useMutation } from "@apollo/client/react";
import { CombinedGraphQLErrors } from "@apollo/client/errors";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useJurisdictions } from "@/components/region/JurisdictionsContext";
import {
  LOCATE_JURISDICTIONS,
  type LocateJurisdictionsData,
  type LocateJurisdictionsVars,
} from "@/lib/graphql/region";
import { US_STATES } from "@/lib/us-states";

/** What went wrong, as the reader needs to hear it. Each has its own copy. */
export type LocateProblem =
  | "denied"
  | "insecure"
  | "noGeolocation"
  | "positionUnavailable"
  | "serviceUnavailable"
  | "rateLimited"
  | "notFound"
  | "failed";

/**
 * Four decimal places is about 11 m: plenty to place a home inside its
 * districts, and less than the browser hands over. We send what the lookup
 * needs, not everything we were given.
 */
const COORDINATE_DECIMALS = 4;

function round(value: number): number {
  const scale = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * scale) / scale;
}

/** The server's error code for a failed lookup, mapped to reader copy. */
export function classifyLocateError(error: unknown): LocateProblem {
  if (CombinedGraphQLErrors.is(error)) {
    const codes = error.errors.map((e) => e.extensions?.code);
    if (codes.includes("LOCATION_SERVICE_UNAVAILABLE")) {
      return "serviceUnavailable";
    }
    if (codes.includes("TOO_MANY_REQUESTS")) return "rateLimited";
    return "failed";
  }
  // The gateway's per-client limiter answers 429 before GraphQL runs.
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 429 ? "rateLimited" : "failed";
}

/** GeolocationPositionError.PERMISSION_DENIED; the constructor isn't
 *  global in every runtime (jsdom, older browsers), so no `instanceof`. */
const PERMISSION_DENIED = 1;

/** A geolocation failure: a `code` and no GraphQL shape. */
function isPositionError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "number" &&
    "PERMISSION_DENIED" in error
  );
}

/** A refused permission is the reader's choice; the others are failures. */
function classifyPositionError(error: { code: number }): LocateProblem {
  return error.code === PERMISSION_DENIED ? "denied" : "positionUnavailable";
}

/**
 * Whether this page can ask for the browser's location at all.
 *
 * Browsers expose geolocation only on a secure page: https, or localhost.
 * Firefox goes further and removes the API entirely elsewhere, and a
 * privacy setting (`geo.enabled`) or policy can remove it anywhere. A
 * button that can't work shouldn't be offered, so the form checks first.
 * jsdom leaves `isSecureContext` undefined; only an explicit false counts.
 */
export function geolocationSupport(): "ok" | "insecure" | "unsupported" {
  if (globalThis.isSecureContext === false) return "insecure";
  return typeof navigator !== "undefined" && "geolocation" in navigator
    ? "ok"
    : "unsupported";
}

const noSubscription = () => () => {};
/** On the server, assume support: the button renders, then corrects. */
const assumeSupported = () => "ok" as const;

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15_000,
      maximumAge: 5 * 60_000,
    });
  });
}

const FIELD =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-content " +
  "focus:outline-none focus:ring-2 focus:ring-accent";
const LABEL = "mb-1 block text-sm font-medium text-content";

interface AddressFields {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
}

const EMPTY_ADDRESS: AddressFields = {
  line1: "",
  city: "",
  state: "CA",
  postalCode: "",
};

/**
 * Find a visitor's districts without an account (#1456).
 *
 * Two ways in: the browser's location, or an address. Either is sent once
 * to `locateJurisdictions` and dropped; neither is kept in component state
 * past the lookup, in storage, or in the Apollo cache (`no-cache`). Only
 * the resulting district ids are kept, on this device, by
 * `JurisdictionsProvider.setLocation`.
 *
 * Self-contained on purpose: a map picker ("tap your county") is being
 * explored and should sit beside this, not replace it. This form is the
 * keyboard and screen-reader path either way.
 */
export function LocateForm({
  onLocated,
}: {
  /** Called after a successful lookup, e.g. to close a "change" panel. */
  readonly onLocated?: () => void;
}) {
  const { t } = useTranslation("region");
  const { setLocation } = useJurisdictions();
  const formId = useId();
  const [address, setAddress] = useState<AddressFields>(EMPTY_ADDRESS);
  const [problem, setProblem] = useState<LocateProblem | null>(null);
  const [busy, setBusy] = useState<"position" | "address" | null>(null);
  const support = useSyncExternalStore(
    noSubscription,
    geolocationSupport,
    assumeSupported,
  );

  const [locate] = useMutation<
    LocateJurisdictionsData,
    LocateJurisdictionsVars
  >(LOCATE_JURISDICTIONS, { fetchPolicy: "no-cache" });

  async function run(
    kind: "position" | "address",
    input: () => Promise<LocateJurisdictionsVars["input"]>,
  ) {
    setProblem(null);
    setBusy(kind);
    try {
      const { data } = await locate({ variables: { input: await input() } });
      const rows = data?.locateJurisdictions ?? [];
      if (rows.length === 0) {
        setProblem("notFound");
        return;
      }
      setLocation(rows);
      setAddress(EMPTY_ADDRESS);
      onLocated?.();
    } catch (error) {
      setProblem(
        isPositionError(error)
          ? classifyPositionError(error)
          : classifyLocateError(error),
      );
    } finally {
      setBusy(null);
    }
  }

  function locateByPosition() {
    const now = geolocationSupport();
    if (now !== "ok") {
      setProblem(now === "insecure" ? "insecure" : "noGeolocation");
      return;
    }
    void run("position", async () => {
      const { coords } = await currentPosition();
      return {
        point: { lat: round(coords.latitude), lng: round(coords.longitude) },
      };
    });
  }

  function submitAddress(event: FormEvent) {
    event.preventDefault();
    const trimmed = {
      line1: address.line1.trim(),
      city: address.city.trim(),
      state: address.state,
      postalCode: address.postalCode.trim(),
    };
    void run("address", async () => ({ address: trimmed }));
  }

  const update =
    (field: keyof AddressFields) => (event: { target: { value: string } }) =>
      setAddress((prev) => ({ ...prev, [field]: event.target.value }));

  return (
    <section
      aria-labelledby={`${formId}-title`}
      className="rounded-lg border border-line bg-surface p-6"
    >
      <h2 id={`${formId}-title`} className="font-semibold text-content">
        {t("locate.title")}
      </h2>
      <p className="mt-1 text-sm text-content-dim">{t("locate.body")}</p>

      {support === "ok" ? (
        <Button
          variant="secondary"
          className="mt-4"
          onClick={locateByPosition}
          disabled={busy !== null}
          aria-describedby={`${formId}-promise`}
        >
          {busy === "position" ? t("locate.locating") : t("locate.useLocation")}
        </Button>
      ) : (
        <p className="mt-4 text-sm text-content-dim">
          {t(
            support === "insecure"
              ? "locate.problems.insecure"
              : "locate.problems.noGeolocation",
          )}
        </p>
      )}

      <form
        onSubmit={submitAddress}
        className="mt-6 space-y-3"
        aria-describedby={`${formId}-promise`}
      >
        <p className="text-sm font-medium text-content-dim">
          {t("locate.orAddress")}
        </p>
        <div>
          <label htmlFor={`${formId}-line1`} className={LABEL}>
            {t("locate.fields.line1")}
          </label>
          <input
            id={`${formId}-line1`}
            required
            maxLength={200}
            autoComplete="address-line1"
            value={address.line1}
            onChange={update("line1")}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor={`${formId}-city`} className={LABEL}>
            {t("locate.fields.city")}
          </label>
          <input
            id={`${formId}-city`}
            required
            maxLength={100}
            autoComplete="address-level2"
            value={address.city}
            onChange={update("city")}
            className={FIELD}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${formId}-state`} className={LABEL}>
              {t("locate.fields.state")}
            </label>
            <select
              id={`${formId}-state`}
              required
              autoComplete="address-level1"
              value={address.state}
              onChange={update("state")}
              className={FIELD}
            >
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${formId}-postal`} className={LABEL}>
              {t("locate.fields.postalCode")}
            </label>
            <input
              id={`${formId}-postal`}
              required
              inputMode="numeric"
              pattern="\d{5}(-\d{4})?"
              maxLength={10}
              autoComplete="postal-code"
              value={address.postalCode}
              onChange={update("postalCode")}
              className={FIELD}
            />
          </div>
        </div>
        <Button type="submit" variant="ghost" disabled={busy !== null}>
          {busy === "address" ? t("locate.finding") : t("locate.findDistricts")}
        </Button>
      </form>

      <p id={`${formId}-promise`} className="mt-4 text-xs text-content-dim">
        {t("locate.promise")}
      </p>

      <p role="status" aria-live="polite" className="mt-3 text-sm text-danger">
        {problem ? t(`locate.problems.${problem}`) : null}
      </p>
    </section>
  );
}

/**
 * Shown once a visitor has a location saved on this device: what it is, and
 * how to change or forget it. Signed in, the location is the account's
 * address, which changes in settings, so this renders nothing.
 */
export function VisitorLocationControl() {
  const { t } = useTranslation("region");
  const { source, jurisdictions, clearLocation } = useJurisdictions();
  const [changing, setChanging] = useState(false);

  if (source !== "device" || jurisdictions.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-line bg-surface-alt p-4 text-sm">
      <p className="text-content-dim">{t("locate.saved")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          aria-expanded={changing}
          onClick={() => setChanging((open) => !open)}
        >
          {t("locate.change")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setChanging(false);
            clearLocation();
          }}
        >
          {t("locate.clear")}
        </Button>
      </div>
      {changing && (
        <div className="mt-4">
          <LocateForm onLocated={() => setChanging(false)} />
        </div>
      )}
    </div>
  );
}
