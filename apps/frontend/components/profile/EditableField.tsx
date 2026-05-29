"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import type { FieldDescriptor } from "@/lib/personalization/vocab";
import { ClearFieldDialog } from "./ClearFieldDialog";
import {
  BooleanField,
  IntegerField,
  MultiSelectChipsField,
  MultiTagInputField,
  SelectField,
  StateField,
  StringInputField,
} from "./inputs";

interface EditableFieldProps {
  readonly descriptor: FieldDescriptor;
  readonly currentValue: unknown;
  readonly onSave: (value: unknown) => Promise<void>;
  readonly onClear: () => Promise<void>;
  readonly locked?: boolean;
}

// The "empty" value for a clear by input type. Matches what the
// backend Prisma update expects: arrays → `[]` (NOT NULL columns),
// scalars/booleans/integers → `null` (nullable columns).
function clearedValueFor(descriptor: FieldDescriptor): unknown {
  switch (descriptor.inputType) {
    case "multi-select-chips":
    case "multi-tag-input":
      return [];
    case "boolean":
    case "integer":
    case "string-input":
    case "string-select":
    case "state":
      return null;
  }
}

// What the field looks like initially when the user enters edit
// mode — driven off the current persisted value, normalized to the
// shape each input subcomponent expects.
function initialDraftFor(
  descriptor: FieldDescriptor,
  currentValue: unknown,
): unknown {
  switch (descriptor.inputType) {
    case "multi-select-chips":
    case "multi-tag-input":
      return Array.isArray(currentValue) ? currentValue : [];
    case "boolean":
      return typeof currentValue === "boolean" ? currentValue : null;
    case "integer":
      return typeof currentValue === "number" ? currentValue : null;
    case "string-input":
    case "string-select":
    case "state":
      return typeof currentValue === "string" ? currentValue : "";
  }
}

// Has the user actually populated this field?
function hasValue(descriptor: FieldDescriptor, value: unknown): boolean {
  switch (descriptor.inputType) {
    case "multi-select-chips":
    case "multi-tag-input":
      return Array.isArray(value) && value.length > 0;
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number";
    case "string-input":
    case "string-select":
    case "state":
      return typeof value === "string" && value.length > 0;
  }
}

function isClearedDraft(descriptor: FieldDescriptor, draft: unknown): boolean {
  return !hasValue(descriptor, draft);
}

// What goes on the wire when the user saves an empty draft via the
// Save button. For most inputs the "set to nothing" case is the
// same as "clear", but for arrays we still want to send `[]`
// (not undefined) so the merge in the backend resolver applies.
function valueToPersist(descriptor: FieldDescriptor, draft: unknown): unknown {
  if (isClearedDraft(descriptor, draft)) {
    return clearedValueFor(descriptor);
  }
  return draft;
}

// Shallow equality used by the skip-write-if-unchanged guard in
// `handleSave`. Strings/numbers/booleans compare by reference;
// arrays compare element-wise (order-insensitive for multi-select,
// since the user could re-order without semantic change). Missing
// values normalize to "cleared" so a null vs empty-string vs empty-
// array delta doesn't look like a change.
function draftMatches(
  descriptor: FieldDescriptor,
  draft: unknown,
  currentValue: unknown,
): boolean {
  const persisted = valueToPersist(
    descriptor,
    initialDraftFor(descriptor, currentValue),
  );
  const next = valueToPersist(descriptor, draft);
  if (Array.isArray(persisted) && Array.isArray(next)) {
    if (persisted.length !== next.length) return false;
    const a = [...(persisted as string[])].sort();
    const b = [...(next as string[])].sort();
    return a.every((v, i) => v === b[i]);
  }
  return persisted === next;
}

export function EditableField({
  descriptor,
  currentValue,
  onSave,
  onClear,
  locked = false,
}: EditableFieldProps) {
  const { t } = useTranslation("profile");
  const inputId = useId();
  const descriptionId = useId();
  const announcementId = useId();

  const [mode, setMode] = useState<"read" | "edit">("read");
  const [draft, setDraft] = useState<unknown>(() =>
    initialDraftFor(descriptor, currentValue),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // The draft is only meaningful in edit mode — `enterEdit()` is
  // what hydrates it from the current persisted value, so no
  // synchronizing effect is needed when the parent refetches with a
  // new value. (The previous useEffect tripped the React 19
  // setState-in-effect rule and risked cascading renders.)

  const label = t(`fields.${descriptor.i18nKey}.label`);
  const description = t(`fields.${descriptor.i18nKey}.description`);
  const present = hasValue(descriptor, currentValue);

  const enterEdit = () => {
    setError(null);
    setDraft(initialDraftFor(descriptor, currentValue));
    setMode("edit");
  };

  const cancelEdit = () => {
    setDraft(initialDraftFor(descriptor, currentValue));
    setError(null);
    setMode("read");
  };

  const handleSave = async () => {
    // Skip-write-if-unchanged — protects against the silent
    // studentLevel collapse + over-3 truncation paths (#758
    // identified the same class of bug for the onboarding chip
    // groups) and saves a wasted mutation when the user enters
    // edit mode but doesn't actually change anything.
    if (draftMatches(descriptor, draft, currentValue)) {
      setMode("read");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(valueToPersist(descriptor, draft));
      setMode("read");
      setAnnouncement(t("field.savedAnnouncement", { label }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("field.errorPrefix"));
    } finally {
      setSaving(false);
    }
  };

  const handleClearConfirm = async () => {
    setDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      await onClear();
      setMode("read");
      setDraft(clearedValueFor(descriptor));
      setAnnouncement(t("field.clearedAnnouncement", { label }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("field.errorPrefix"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-field={descriptor.name}
      className="py-4 border-b border-gray-200 last:border-b-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-900"
          >
            {label}
          </label>
          <p id={descriptionId} className="text-xs text-gray-500 mt-0.5">
            {description}
          </p>
          {locked && (
            <p className="text-xs text-amber-700 mt-1 italic">
              {t("field.lockedByNoFields")}
            </p>
          )}
        </div>
        {mode === "read" && !locked && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={enterEdit}
              className="text-sm text-[#5A7A6A] hover:text-[#2D4A3C] font-medium px-2 py-1"
            >
              {t("field.edit")}
            </button>
            {present && (
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                aria-label={`${t("field.clear")} — ${label}`}
                className="text-sm text-gray-500 hover:text-red-700 px-2 py-1"
              >
                {t("field.clear")}
              </button>
            )}
          </div>
        )}
      </div>

      {mode === "read" && (
        <ReadModeValue
          descriptor={descriptor}
          currentValue={currentValue}
          present={present}
        />
      )}

      {mode === "edit" && (
        <div className="mt-3 space-y-3">
          <InputDispatch
            descriptor={descriptor}
            value={draft}
            onChange={setDraft}
            disabled={saving || locked}
            inputId={inputId}
            ariaDescribedBy={descriptionId}
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {t("field.errorPrefix")} {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 rounded-lg disabled:opacity-50"
            >
              {t("field.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-sm font-semibold bg-[#5A7A6A] text-white rounded-lg hover:bg-[#2D4A3C] disabled:opacity-50"
            >
              {t("field.save")}
            </button>
          </div>
        </div>
      )}

      <output
        id={announcementId}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </output>

      <ClearFieldDialog
        open={dialogOpen}
        fieldLabel={label}
        onConfirm={handleClearConfirm}
        onCancel={() => setDialogOpen(false)}
      />
    </div>
  );
}

// ============================================================
// Read-mode value rendering
// ============================================================

function ReadModeValue({
  descriptor,
  currentValue,
  present,
}: {
  readonly descriptor: FieldDescriptor;
  readonly currentValue: unknown;
  readonly present: boolean;
}) {
  const { t } = useTranslation("profile");
  if (!present) {
    return (
      <p className="mt-1 text-sm text-gray-500 italic">{t("field.notSet")}</p>
    );
  }
  return (
    <p className="mt-1 text-sm text-gray-900">
      {formatValue(descriptor, currentValue)}
    </p>
  );
}

// Translation helper that pulls from the i18n singleton instead of
// the hook-scoped `t`. Module-level so it can be used inside the
// non-component `formatValue` without hook-typing gymnastics.
function tProfile(key: string, fallback?: string): string {
  return i18n.t(key, { ns: "profile", defaultValue: fallback ?? key });
}

function formatValue(descriptor: FieldDescriptor, value: unknown): string {
  const t = tProfile;
  switch (descriptor.inputType) {
    case "boolean":
      return value ? t("field.yes") : t("field.no");
    case "integer":
      return String(value);
    case "string-select":
      return t(
        `fields.${descriptor.i18nKey}.options.${value as string}`,
        value as string,
      );
    case "multi-select-chips": {
      const arr = (value as string[]) ?? [];
      return arr
        .map((v) => t(`fields.${descriptor.i18nKey}.options.${v}`, v))
        .join(", ");
    }
    case "multi-tag-input":
      return ((value as string[]) ?? []).join(", ");
    case "string-input":
    case "state":
    default:
      return value as string;
  }
}

// ============================================================
// Input dispatch
// ============================================================

function InputDispatch({
  descriptor,
  value,
  onChange,
  disabled,
  inputId,
  ariaDescribedBy,
}: {
  readonly descriptor: FieldDescriptor;
  readonly value: unknown;
  readonly onChange: (next: unknown) => void;
  readonly disabled?: boolean;
  readonly inputId: string;
  readonly ariaDescribedBy: string;
}) {
  switch (descriptor.inputType) {
    case "string-input":
      return (
        <StringInputField
          descriptor={descriptor}
          value={(value as string) ?? ""}
          onChange={onChange}
          disabled={disabled}
          inputId={inputId}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case "string-select":
      return (
        <SelectField
          descriptor={descriptor}
          value={(value as string) ?? ""}
          onChange={onChange}
          disabled={disabled}
          inputId={inputId}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case "boolean":
      return (
        <BooleanField
          descriptor={descriptor}
          value={value as boolean | null}
          onChange={onChange}
          disabled={disabled}
          inputId={inputId}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case "multi-select-chips":
      return (
        <MultiSelectChipsField
          descriptor={descriptor}
          value={(value as string[]) ?? []}
          onChange={onChange}
          disabled={disabled}
          inputId={inputId}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case "multi-tag-input":
      return (
        <MultiTagInputField
          descriptor={descriptor}
          value={(value as string[]) ?? []}
          onChange={onChange}
          disabled={disabled}
          inputId={inputId}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case "integer":
      return (
        <IntegerField
          descriptor={descriptor}
          value={value as number | null}
          onChange={onChange}
          disabled={disabled}
          inputId={inputId}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case "state":
      return (
        <StateField
          descriptor={descriptor}
          value={(value as string) ?? ""}
          onChange={onChange}
          disabled={disabled}
          inputId={inputId}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
  }
}
