"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";

/**
 * Which quantity the county map encodes.
 *
 * `share` is the default because it is the mode that carries the argument:
 * §9118 pegs the threshold to votes *cast*, so its size relative to the
 * electorate moves with turnout, and that relationship is the point.
 *
 * `people` exists because raw signature counts span four orders of magnitude —
 * 62 in Alpine against 238,923 in Los Angeles. On a linear ramp that renders
 * 55 of 58 counties as the same colour, so it uses a log ramp.
 */
export type MapMode = "share" | "people";

export interface MapModeToggleProps {
  value: MapMode;
  onChange: (mode: MapMode) => void;
  className?: string;
}

/**
 * A real radio group, not two buttons that look like one.
 *
 * The modes are mutually exclusive options over one question, which is what
 * `radiogroup` means; native radios give arrow-key traversal, a single tab
 * stop and correct announcement for free. Reimplementing that with buttons and
 * `aria-pressed` is how a control ends up keyboard-hostile.
 */
export function MapModeToggle({
  value,
  onChange,
  className,
}: MapModeToggleProps) {
  const { t } = useTranslation("landing");
  const groupName = useId();

  const modes: { id: MapMode; label: string; hint: string }[] = [
    {
      id: "share",
      label: t("counties.modes.share"),
      hint: t("counties.modes.shareHint"),
    },
    {
      id: "people",
      label: t("counties.modes.people"),
      hint: t("counties.modes.peopleHint"),
    },
  ];

  return (
    <fieldset className={className}>
      <legend className="sr-only">{t("counties.modes.legend")}</legend>

      {/*
        A segmented control on the surface, a radio group underneath. The
        inputs are visually hidden rather than replaced by buttons, so arrow-key
        traversal, the single tab stop and correct announcement all still come
        from the native control — the styling rides on :checked and
        :focus-visible via peer-*.
      */}
      <div className="inline-flex rounded-md border border-[var(--color-line)] bg-surface-alt p-0.5">
        {modes.map((mode) => {
          const inputId = `${groupName}-${mode.id}`;
          return (
            <div key={mode.id} className="contents">
              <input
                type="radio"
                id={inputId}
                name={groupName}
                value={mode.id}
                checked={value === mode.id}
                onChange={() => onChange(mode.id)}
                title={mode.hint}
                className="peer sr-only"
              />
              <label
                htmlFor={inputId}
                title={mode.hint}
                className="cursor-pointer rounded px-3 py-1.5 text-sm text-content-dim transition-colors peer-checked:bg-surface peer-checked:font-medium peer-checked:text-content peer-checked:shadow-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-accent)]"
              >
                {mode.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
