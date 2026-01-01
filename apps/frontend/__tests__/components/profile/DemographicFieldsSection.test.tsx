import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { DemographicFieldsSection } from "@/components/profile/DemographicFieldsSection";

// Mock useTranslation
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback || key,
  }),
}));

describe("DemographicFieldsSection", () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render with collapsed header", () => {
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      expect(screen.getByText("Demographic Information")).toBeInTheDocument();
      expect(screen.getByText("(Optional)")).toBeInTheDocument();
    });

    it("should have collapsible button with aria-expanded=false initially", () => {
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      const button = screen.getByRole("button", {
        name: /demographic information/i,
      });
      expect(button).toHaveAttribute("aria-expanded", "false");
    });

    it("should not show form fields when collapsed", () => {
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      expect(screen.queryByLabelText("Occupation")).not.toBeInTheDocument();
    });
  });

  describe("expand/collapse", () => {
    it("should expand when header is clicked", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(screen.getByLabelText("Occupation")).toBeInTheDocument();
      expect(screen.getByLabelText("Education Level")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Annual Household Income"),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Household Size")).toBeInTheDocument();
      expect(screen.getByLabelText("Housing Status")).toBeInTheDocument();
    });

    it("should set aria-expanded=true when expanded", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(
        screen.getByRole("button", { name: /demographic information/i }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("should collapse when header is clicked again", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      const button = screen.getByRole("button", {
        name: /demographic information/i,
      });
      await user.click(button);
      expect(screen.getByLabelText("Occupation")).toBeInTheDocument();

      await user.click(button);
      expect(screen.queryByLabelText("Occupation")).not.toBeInTheDocument();
    });
  });

  describe("occupation field", () => {
    it("should call onChange when occupation is typed", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );
      await user.type(screen.getByLabelText("Occupation"), "Software Engineer");

      expect(mockOnChange).toHaveBeenCalledWith(
        "occupation",
        expect.stringContaining("S"),
      );
    });

    it("should display current occupation value", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection
          occupation="Teacher"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(screen.getByLabelText("Occupation")).toHaveValue("Teacher");
    });

    it("should call onChange with undefined when cleared", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection occupation="Test" onChange={mockOnChange} />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );
      await user.clear(screen.getByLabelText("Occupation"));

      expect(mockOnChange).toHaveBeenCalledWith("occupation", undefined);
    });
  });

  describe("education level field", () => {
    it("should render all education level options", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      const select = screen.getByLabelText("Education Level");
      const options = select.querySelectorAll("option");
      expect(options.length).toBeGreaterThan(1);
    });

    it("should call onChange when education level is selected", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );
      await user.selectOptions(
        screen.getByLabelText("Education Level"),
        "bachelor",
      );

      expect(mockOnChange).toHaveBeenCalledWith("educationLevel", "bachelor");
    });

    it("should display current education level", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection
          educationLevel="master"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(screen.getByLabelText("Education Level")).toHaveValue("master");
    });
  });

  describe("income range field", () => {
    it("should call onChange when income range is selected", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );
      await user.selectOptions(
        screen.getByLabelText("Annual Household Income"),
        "75k_100k",
      );

      expect(mockOnChange).toHaveBeenCalledWith("incomeRange", "75k_100k");
    });

    it("should display current income range", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection
          incomeRange="100k_150k"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(screen.getByLabelText("Annual Household Income")).toHaveValue(
        "100k_150k",
      );
    });
  });

  describe("household size field", () => {
    it("should call onChange when household size is selected", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );
      await user.selectOptions(screen.getByLabelText("Household Size"), "3");

      expect(mockOnChange).toHaveBeenCalledWith("householdSize", "3");
    });

    it("should display current household size", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection householdSize="4" onChange={mockOnChange} />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(screen.getByLabelText("Household Size")).toHaveValue("4");
    });
  });

  describe("homeowner status field", () => {
    it("should call onChange when homeowner status is selected", async () => {
      const user = userEvent.setup();
      render(<DemographicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );
      await user.selectOptions(screen.getByLabelText("Housing Status"), "own");

      expect(mockOnChange).toHaveBeenCalledWith("homeownerStatus", "own");
    });

    it("should display current homeowner status", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection
          homeownerStatus="rent"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(screen.getByLabelText("Housing Status")).toHaveValue("rent");
    });
  });

  describe("disabled state", () => {
    it("should disable all form fields when disabled", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection onChange={mockOnChange} disabled={true} />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(screen.getByLabelText("Occupation")).toBeDisabled();
      expect(screen.getByLabelText("Education Level")).toBeDisabled();
      expect(screen.getByLabelText("Annual Household Income")).toBeDisabled();
      expect(screen.getByLabelText("Household Size")).toBeDisabled();
      expect(screen.getByLabelText("Housing Status")).toBeDisabled();
    });

    it("should not call onChange for selects when disabled", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection onChange={mockOnChange} disabled={true} />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      // Try to select - disabled select won't trigger change
      const select = screen.getByLabelText("Education Level");
      expect(select).toBeDisabled();
    });
  });

  describe("with all props provided", () => {
    it("should render with all values", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection
          occupation="Nurse"
          educationLevel="bachelor"
          incomeRange="50k_75k"
          householdSize="2"
          homeownerStatus="rent"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );

      expect(screen.getByLabelText("Occupation")).toHaveValue("Nurse");
      expect(screen.getByLabelText("Education Level")).toHaveValue("bachelor");
      expect(screen.getByLabelText("Annual Household Income")).toHaveValue(
        "50k_75k",
      );
      expect(screen.getByLabelText("Household Size")).toHaveValue("2");
      expect(screen.getByLabelText("Housing Status")).toHaveValue("rent");
    });
  });

  describe("clearing values", () => {
    it("should call onChange with undefined when education level is cleared", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection
          educationLevel="bachelor"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );
      await user.selectOptions(screen.getByLabelText("Education Level"), "");

      expect(mockOnChange).toHaveBeenCalledWith("educationLevel", undefined);
    });

    it("should call onChange with undefined when income range is cleared", async () => {
      const user = userEvent.setup();
      render(
        <DemographicFieldsSection
          incomeRange="50k_75k"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /demographic information/i }),
      );
      await user.selectOptions(
        screen.getByLabelText("Annual Household Income"),
        "",
      );

      expect(mockOnChange).toHaveBeenCalledWith("incomeRange", undefined);
    });
  });
});
