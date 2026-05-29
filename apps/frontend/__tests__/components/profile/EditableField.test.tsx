/**
 * EditableField unit tests — the component-internal contract that
 * the page-level e2e is too coarse to probe:
 *  - mode transitions (read ↔ edit ↔ dialog)
 *  - skip-write-if-unchanged guard
 *  - mutation success / error paths
 *  - locked-by-noFieldsMode contract
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { EditableField } from "@/components/profile/EditableField";
import type { FieldDescriptor } from "@/lib/personalization/vocab";

const housingTenure: FieldDescriptor = {
  name: "housingTenure",
  profile: "signal",
  category: "housing",
  tier: "T2",
  inputType: "string-select",
  options: ["renter", "owner"],
  maxLength: 50,
  i18nKey: "housingTenure",
};

const educator: FieldDescriptor = {
  name: "educator",
  profile: "signal",
  category: "education",
  tier: "T2",
  inputType: "boolean",
  i18nKey: "educator",
};

const interestTags: FieldDescriptor = {
  name: "interestTags",
  profile: "signal",
  category: "values",
  tier: "T1",
  inputType: "multi-select-chips",
  options: ["housing", "jobs", "healthcare"],
  i18nKey: "interestTags",
};

describe("EditableField — read mode", () => {
  it("renders the current value via the controlled-vocab i18n option", () => {
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={jest.fn()}
        onClear={jest.fn()}
      />,
    );
    expect(screen.getByText("I rent")).toBeInTheDocument();
  });

  it("renders 'Not set' when the field is null/empty", () => {
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue={null}
        onSave={jest.fn()}
        onClear={jest.fn()}
      />,
    );
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("hides the Clear button when there's no value to clear", () => {
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue={null}
        onSave={jest.fn()}
        onClear={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /clear value/i })).toBeNull();
  });

  it("formats boolean values via the i18n yes/no keys", () => {
    render(
      <EditableField
        descriptor={educator}
        currentValue={true}
        onSave={jest.fn()}
        onClear={jest.fn()}
      />,
    );
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("formats multi-select arrays as comma-joined i18n option labels", () => {
    render(
      <EditableField
        descriptor={interestTags}
        currentValue={["housing", "jobs"]}
        onSave={jest.fn()}
        onClear={jest.fn()}
      />,
    );
    expect(
      screen.getByText("Housing & rent, Jobs & workers"),
    ).toBeInTheDocument();
  });
});

describe("EditableField — edit flow", () => {
  it("entering edit mode replaces the read-mode value with the input", async () => {
    const user = userEvent.setup();
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={jest.fn()}
        onClear={jest.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^cancel$/i }),
    ).toBeInTheDocument();
  });

  it("cancel reverts the draft and returns to read mode", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={onSave}
        onClear={jest.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    await user.selectOptions(screen.getByRole("combobox"), "owner");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("I rent")).toBeInTheDocument();
  });

  it("save with a changed draft calls onSave with the new value", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={onSave}
        onClear={jest.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    await user.selectOptions(screen.getByRole("combobox"), "owner");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("owner"));
  });

  it("save with an unchanged draft skips the mutation (skip-write guard)", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={onSave}
        onClear={jest.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    // No selection change — same value as currentValue.
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    // Mode returned to read.
    expect(
      screen.queryByRole("button", { name: /^save$/i }),
    ).not.toBeInTheDocument();
  });

  it("save with a mutation error keeps the user in edit mode with the error visible", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockRejectedValue(new Error("Boom"));
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={onSave}
        onClear={jest.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    await user.selectOptions(screen.getByRole("combobox"), "owner");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/i),
    );
    // Still in edit mode.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});

describe("EditableField — clear flow", () => {
  it("Clear button opens the confirm dialog", async () => {
    const user = userEvent.setup();
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={jest.fn()}
        onClear={jest.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /clear value/i }));
    expect(
      screen.getByRole("dialog", { name: /clear this value/i }),
    ).toBeInTheDocument();
  });

  it("Confirming the dialog calls onClear", async () => {
    const user = userEvent.setup();
    const onClear = jest.fn().mockResolvedValue(undefined);
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={jest.fn()}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByRole("button", { name: /clear value/i }));
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    await waitFor(() => expect(onClear).toHaveBeenCalled());
  });
});

describe("EditableField — locked", () => {
  it("locked prop hides both Edit and Clear buttons + shows the paused note", () => {
    render(
      <EditableField
        descriptor={housingTenure}
        currentValue="renter"
        onSave={jest.fn()}
        onClear={jest.fn()}
        locked
      />,
    );
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /clear value/i })).toBeNull();
    expect(
      screen.getByText(/paused while sensitive fields are off/i),
    ).toBeInTheDocument();
  });
});
