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
                ? "bg-accent text-white border-accent"
                : "bg-surface text-content border-line hover:border-gray-400",
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
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent text-white text-sm"
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
