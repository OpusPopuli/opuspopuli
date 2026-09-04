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
      <legend className="text-sm font-medium text-content-dim mb-2">
        {t("counties.modes.legend")}
      </legend>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
        {modes.map((mode) => {
          const inputId = `${groupName}-${mode.id}`;
          const hintId = `${inputId}-hint`;
          return (
            <div key={mode.id} className="flex items-start gap-2">
              <input
                type="radio"
                id={inputId}
                name={groupName}
                value={mode.id}
                checked={value === mode.id}
                onChange={() => onChange(mode.id)}
                aria-describedby={hintId}
                className="mt-1 h-4 w-4 accent-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              />
              <label htmlFor={inputId} className="text-sm text-content">
                <span className="block font-medium">{mode.label}</span>
                {/* The hint is associated rather than adjacent, so a screen
                    reader reads why the scale differs, not just its name. */}
                <span id={hintId} className="block text-xs text-content-dim">
                  {mode.hint}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
