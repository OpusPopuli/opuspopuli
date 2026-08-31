"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FieldDescriptor } from "@/lib/personalization/vocab";
import { US_STATES } from "@/lib/us-states";

const baseInputClass =
  "w-full px-3 py-2 rounded-lg border border-line bg-surface text-content focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:bg-surface-alt disabled:text-content-dim";

interface BaseProps {
  readonly descriptor: FieldDescriptor;
  readonly disabled?: boolean;
  readonly inputId: string;
  readonly ariaDescribedBy?: string;
}

// ============================================================
// StringInputField — free-form text
// ============================================================

export function StringInputField({
  descriptor,
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: BaseProps & {
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  return (
    <input
      id={inputId}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={descriptor.maxLength}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      className={baseInputClass}
    />
  );
}

// ============================================================
// SelectField — single-value controlled vocab
// ============================================================

export function SelectField({
  descriptor,
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: BaseProps & {
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const { t } = useTranslation("profile");
  return (
    <select
      id={inputId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      className={baseInputClass}
    >
      <option value="">{t("field.notSet")}</option>
      {(descriptor.options ?? []).map((opt) => (
        <option key={opt} value={opt}>
          {t(`fields.${descriptor.i18nKey}.options.${opt}`, opt)}
        </option>
      ))}
    </select>
  );
}

// ============================================================
// BooleanField — three-state segmented toggle (true / false / unset)
// ============================================================

export function BooleanField({
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: BaseProps & {
  readonly value: boolean | null;
  readonly onChange: (next: boolean | null) => void;
}) {
  const { t } = useTranslation("profile");
  // Two-state segmented control — "set to nothing" is the page-wide
  // "Clear value" button's job, not a third radio option here.
  const options: { v: boolean; labelKey: string }[] = [
    { v: true, labelKey: "field.yes" },
    { v: false, labelKey: "field.no" },
  ];

  return (
    <fieldset
      id={inputId}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      className="inline-flex bg-surface-alt rounded-lg p-1 border border-line"
    >
      {options.map(({ v, labelKey }) => {
        const active = value === v;
        return (
          <label
            key={String(v)}
            className={[
              "px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors",
              "focus-within:ring-2 focus-within:ring-accent",
              active
                ? "bg-surface text-content font-medium"
                : "text-content-dim hover:text-content",
              disabled ? "cursor-not-allowed opacity-50" : "",
            ].join(" ")}
          >
            <input
              type="radio"
              name={inputId}
              value={String(v)}
              checked={active}
              onChange={() => onChange(v)}
              disabled={disabled}
              className="sr-only"
            />
            {t(labelKey)}
          </label>
        );
      })}
    </fieldset>
  );
}

// ============================================================
// MultiSelectChipsField — controlled-vocab chip group
// ============================================================

export function MultiSelectChipsField({
  descriptor,
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: BaseProps & {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const { t } = useTranslation("profile");
  const toggle = (opt: string) => {
    if (disabled) return;
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };
  return (
    <fieldset
      id={inputId}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      className="flex flex-wrap gap-2"
    >
      {(descriptor.options ?? []).map((opt) => {
        const active = value.includes(opt);
        return (
          <label
            key={opt}
            className={[
              "px-3 py-1.5 rounded-full text-sm cursor-pointer border transition-colors",
              "focus-within:ring-2 focus-within:ring-accent",
              active
                ? "bg-accent text-content border-accent"
                : "bg-surface text-content border-line hover:border-line",
              disabled ? "cursor-not-allowed opacity-50" : "",
            ].join(" ")}
          >
            <input
              type="checkbox"
              checked={active}
              disabled={disabled}
              onChange={() => toggle(opt)}
              className="sr-only"
            />
            {t(`fields.${descriptor.i18nKey}.options.${opt}`, opt)}
          </label>
        );
      })}
    </fieldset>
  );
}

// ============================================================
// MultiSelectDropdownField — controlled vocab picked from a dropdown,
// kept as an ordered chip list where the first entry is the primary
// ============================================================

/**
 * One selected value. The first chip in the list is the primary — it
 * says so instead of offering a "make primary" action, and the others
 * offer one that promotes them to the front.
 */
function SelectedValueChip({
  label,
  isPrimary,
  primaryBadge,
  makePrimaryLabel,
  makePrimaryAriaLabel,
  removeLabel,
  disabled,
  onMakePrimary,
  onRemove,
}: {
  readonly label: string;
  readonly isPrimary: boolean;
  readonly primaryBadge: string;
  readonly makePrimaryLabel: string;
  readonly makePrimaryAriaLabel: string;
  readonly removeLabel: string;
  readonly disabled?: boolean;
  readonly onMakePrimary: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm border",
        isPrimary
          ? "bg-accent text-content border-accent font-medium"
          : "bg-surface text-content border-line",
      ].join(" ")}
    >
      {label}
      {isPrimary && (
        <span className="text-xs uppercase tracking-wide">{primaryBadge}</span>
      )}
      {!isPrimary && !disabled && (
        <button
          type="button"
          onClick={onMakePrimary}
          aria-label={makePrimaryAriaLabel}
          // min-h-6 keeps the hit area at the WCAG 2.2 AA 24px floor.
          className="text-xs underline hover:no-underline min-h-6 px-1"
        >
          {makePrimaryLabel}
        </button>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="rounded-full w-6 h-6 flex items-center justify-center text-sm hover:bg-surface-alt"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function MultiSelectDropdownField({
  descriptor,
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: BaseProps & {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const { t } = useTranslation("profile");
  const hintId = `${inputId}-primary-hint`;

  const labelFor = (opt: string) =>
    t(`fields.${descriptor.i18nKey}.options.${opt}`, { defaultValue: opt });

  // Values already chosen drop out of the dropdown, so the same one
  // can't be added twice.
  const remaining = (descriptor.options ?? []).filter(
    (opt) => !value.includes(opt),
  );

  const add = (opt: string) => {
    if (!opt || value.includes(opt)) return;
    onChange([...value, opt]);
  };

  const makePrimary = (opt: string) => {
    onChange([opt, ...value.filter((v) => v !== opt)]);
  };

  const remove = (opt: string) => {
    onChange(value.filter((v) => v !== opt));
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((opt, index) => {
            const label = labelFor(opt);
            return (
              <SelectedValueChip
                key={opt}
                label={label}
                isPrimary={index === 0}
                primaryBadge={t("field.multiSelect.primaryBadge")}
                makePrimaryLabel={t("field.multiSelect.makePrimaryShort")}
                makePrimaryAriaLabel={t("field.multiSelect.makePrimary", {
                  value: label,
                })}
                removeLabel={t("field.multiSelect.remove", { value: label })}
                disabled={disabled}
                onMakePrimary={() => makePrimary(opt)}
                onRemove={() => remove(opt)}
              />
            );
          })}
        </div>
      )}
      <select
        id={inputId}
        // A picker, not a value holder — it resets after every pick so
        // the chip list stays the single source of truth.
        value=""
        onChange={(e) => add(e.target.value)}
        disabled={disabled || remaining.length === 0}
        aria-describedby={[ariaDescribedBy, hintId].filter(Boolean).join(" ")}
        className={baseInputClass}
      >
        <option value="">{t("field.multiSelect.add")}</option>
        {remaining.map((opt) => (
          <option key={opt} value={opt}>
            {labelFor(opt)}
          </option>
        ))}
      </select>
      <p id={hintId} className="text-xs text-content-dim">
        {t("field.multiSelect.primaryHint")}
      </p>
    </div>
  );
}

// ============================================================
// MultiTagInputField — free-form tag list (Enter to add, x to remove)
// ============================================================

export function MultiTagInputField({
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: BaseProps & {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed || value.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  const remove = (tag: string) => {
    onChange(value.filter((v) => v !== tag));
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent text-content text-sm"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove ${tag}`}
                className="hover:bg-surface/20 rounded-full w-4 h-4 flex items-center justify-center text-xs"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <input
        id={inputId}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={add}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        placeholder="Type and press Enter"
        className={baseInputClass}
      />
    </div>
  );
}

// ============================================================
// IntegerField — bounded number
// ============================================================

export function IntegerField({
  descriptor,
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: BaseProps & {
  readonly value: number | null;
  readonly onChange: (next: number | null) => void;
}) {
  return (
    <input
      id={inputId}
      type="number"
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(null);
          return;
        }
        const parsed = Number.parseInt(raw, 10);
        onChange(Number.isNaN(parsed) ? null : parsed);
      }}
      min={descriptor.min}
      max={descriptor.max}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      className={baseInputClass}
    />
  );
}

// ============================================================
// StateField — US state dropdown
// ============================================================

export function StateField({
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: BaseProps & {
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const { t } = useTranslation("profile");
  return (
    <select
      id={inputId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      className={baseInputClass}
    >
      <option value="">{t("field.notSet")}</option>
      {US_STATES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
