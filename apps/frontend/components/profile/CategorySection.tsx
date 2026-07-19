"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CategoryPresentation } from "@/lib/personalization/categories";
import { EditableField } from "./EditableField";

interface CategorySectionProps {
  readonly presentation: CategoryPresentation;
  readonly getCurrentValue: (fieldName: string) => unknown;
  readonly onSaveField: (fieldName: string, value: unknown) => Promise<void>;
  readonly onClearField: (fieldName: string) => Promise<void>;
  readonly locked?: boolean;
}

export function CategorySection({
  presentation,
  getCurrentValue,
  onSaveField,
  onClearField,
  locked = false,
}: CategorySectionProps) {
  const { t } = useTranslation("profile");
  const [expanded, setExpanded] = useState(presentation.defaultExpanded);
  const headerId = `cat-header-${presentation.category}`;
  const panelId = `cat-panel-${presentation.category}`;

  return (
    <section className="border border-line rounded-lg overflow-hidden bg-surface">
      <h3 className="m-0">
        <button
          id={headerId}
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={
            expanded ? t("categoryLabel.collapse") : t("categoryLabel.expand")
          }
          className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-surface-alt focus:outline-none focus:bg-surface-alt focus:ring-2 focus:ring-inset focus:ring-accent"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-base font-semibold text-content">
              {t(`category.${presentation.category}.title`)}
            </span>
            <span className="block text-xs text-content-dim mt-0.5">
              {t(`category.${presentation.category}.summary`)}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`text-content-dim transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </button>
      </h3>
      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="px-4 py-1 bg-surface"
        >
          {presentation.fields.map((descriptor) => (
            <EditableField
              key={descriptor.name}
              descriptor={descriptor}
              currentValue={getCurrentValue(descriptor.name)}
              onSave={(value) => onSaveField(descriptor.name, value)}
              onClear={() => onClearField(descriptor.name)}
              locked={locked}
            />
          ))}
        </div>
      )}
    </section>
  );
}
