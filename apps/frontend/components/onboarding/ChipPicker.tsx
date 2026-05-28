"use client";

import { useId } from "react";

export interface ChipOption {
  readonly value: string;
  readonly label: string;
}

interface BaseProps {
  readonly options: readonly ChipOption[];
  readonly groupLabel: string;
  readonly columns?: 2 | 3 | 4;
}

interface SingleProps extends BaseProps {
  readonly mode: "single";
  readonly selected: string | null;
  readonly onChange: (value: string | null) => void;
}

interface MultiProps extends BaseProps {
  readonly mode: "multi";
  readonly selected: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  /**
   * Hard cap on selection count. Once reached, unselected chips become
   * non-interactive (visually + ARIA-disabled) so the user can't pick
   * more — but already-selected chips remain toggleable so they can
   * swap. Toggling off a selected chip frees up a slot.
   */
  readonly maxSelections?: number;
}

type Props = SingleProps | MultiProps;

const colsClass: Record<2 | 3 | 4, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
};

function chipStateClassFor(blocked: boolean, selected: boolean): string {
  if (blocked) {
    return "bg-white/5 text-white/40 border-white/10 cursor-not-allowed";
  }
  if (selected) {
    return "bg-white text-[#2D4A3C] border-white cursor-pointer";
  }
  return "bg-white/10 text-white border-white/30 hover:bg-white/15 cursor-pointer";
}

export function ChipPicker(props: Props) {
  const { options, groupLabel, columns = 2 } = props;
  const groupId = useId();
  const groupName = `chip-${groupId}`;

  const isSelected = (value: string) =>
    props.mode === "single"
      ? props.selected === value
      : props.selected.includes(value);

  const atCap =
    props.mode === "multi" &&
    props.maxSelections !== undefined &&
    props.selected.length >= props.maxSelections;

  const toggle = (value: string) => {
    if (props.mode === "single") {
      props.onChange(props.selected === value ? null : value);
      return;
    }
    const alreadySelected = props.selected.includes(value);
    if (atCap && !alreadySelected) return; // blocked by cap
    const next = alreadySelected
      ? props.selected.filter((v) => v !== value)
      : [...props.selected, value];
    props.onChange(next);
  };

  const inputType = props.mode === "single" ? "radio" : "checkbox";

  return (
    <fieldset className="w-full">
      <legend className="block text-white/90 font-medium mb-3 text-sm">
        {groupLabel}
      </legend>
      <div className={`grid ${colsClass[columns]} gap-2`}>
        {options.map((option) => {
          const selected = isSelected(option.value);
          const blocked = atCap && !selected;
          const inputId = `${groupName}-${option.value}`;
          const chipStateClass = chipStateClassFor(blocked, selected);
          return (
            <label
              key={option.value}
              htmlFor={inputId}
              aria-disabled={blocked || undefined}
              className={[
                "flex items-center justify-center text-center",
                "px-3 py-2.5 rounded-xl border",
                "text-sm font-medium transition-colors",
                "focus-within:ring-2 focus-within:ring-white focus-within:ring-offset-2 focus-within:ring-offset-transparent",
                chipStateClass,
              ].join(" ")}
            >
              <input
                id={inputId}
                type={inputType}
                name={groupName}
                value={option.value}
                checked={selected}
                disabled={blocked}
                onChange={() => toggle(option.value)}
                className="sr-only"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
