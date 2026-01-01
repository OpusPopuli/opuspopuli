import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CivicFieldsSection } from "@/components/profile/CivicFieldsSection";

// Mock useTranslation
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback || key,
  }),
}));

describe("CivicFieldsSection", () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render with collapsed header", () => {
      render(<CivicFieldsSection onChange={mockOnChange} />);

      expect(screen.getByText("Civic Information")).toBeInTheDocument();
      expect(screen.getByText("(Optional)")).toBeInTheDocument();
    });

    it("should have collapsible button with aria-expanded=false initially", () => {
      render(<CivicFieldsSection onChange={mockOnChange} />);

      const button = screen.getByRole("button", { name: /civic information/i });
      expect(button).toHaveAttribute("aria-expanded", "false");
    });

    it("should not show form fields when collapsed", () => {
      render(<CivicFieldsSection onChange={mockOnChange} />);

      expect(
        screen.queryByLabelText("Political Affiliation"),
      ).not.toBeInTheDocument();
    });
  });

  describe("expand/collapse", () => {
    it("should expand when header is clicked", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      expect(
        screen.getByLabelText("Political Affiliation"),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Voting Frequency")).toBeInTheDocument();
    });

    it("should set aria-expanded=true when expanded", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      expect(
        screen.getByRole("button", { name: /civic information/i }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("should collapse when header is clicked again", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} />);

      const button = screen.getByRole("button", { name: /civic information/i });
      await user.click(button);
      expect(
        screen.getByLabelText("Political Affiliation"),
      ).toBeInTheDocument();

      await user.click(button);
      expect(
        screen.queryByLabelText("Political Affiliation"),
      ).not.toBeInTheDocument();
    });
  });

  describe("political affiliation", () => {
    it("should render all political affiliation options", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      const select = screen.getByLabelText("Political Affiliation");
      expect(select).toBeInTheDocument();

      // Check for some options
      const options = select.querySelectorAll("option");
      expect(options.length).toBeGreaterThan(1);
    });

    it("should call onChange when political affiliation is selected", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );
      await user.selectOptions(
        screen.getByLabelText("Political Affiliation"),
        "democrat",
      );

      expect(mockOnChange).toHaveBeenCalledWith(
        "politicalAffiliation",
        "democrat",
      );
    });

    it("should call onChange with undefined when cleared", async () => {
      const user = userEvent.setup();
      render(
        <CivicFieldsSection
          politicalAffiliation="democrat"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );
      await user.selectOptions(
        screen.getByLabelText("Political Affiliation"),
        "",
      );

      expect(mockOnChange).toHaveBeenCalledWith(
        "politicalAffiliation",
        undefined,
      );
    });

    it("should display current value", async () => {
      const user = userEvent.setup();
      render(
        <CivicFieldsSection
          politicalAffiliation="republican"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      expect(screen.getByLabelText("Political Affiliation")).toHaveValue(
        "republican",
      );
    });
  });

  describe("voting frequency", () => {
    it("should call onChange when voting frequency is selected", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );
      await user.selectOptions(
        screen.getByLabelText("Voting Frequency"),
        "every_election",
      );

      expect(mockOnChange).toHaveBeenCalledWith(
        "votingFrequency",
        "every_election",
      );
    });

    it("should display current value", async () => {
      const user = userEvent.setup();
      render(
        <CivicFieldsSection
          votingFrequency="most_elections"
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      expect(screen.getByLabelText("Voting Frequency")).toHaveValue(
        "most_elections",
      );
    });
  });

  describe("policy priorities", () => {
    it("should render policy priority checkboxes", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      expect(screen.getByText("Policy Priorities")).toBeInTheDocument();
      expect(screen.getByText("(Select all that apply)")).toBeInTheDocument();
    });

    it("should call onChange when policy priority is selected", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      // Find and click a policy priority checkbox
      const healthcareLabel = screen.getByText("healthcare");
      await user.click(healthcareLabel);

      expect(mockOnChange).toHaveBeenCalledWith("policyPriorities", [
        "healthcare",
      ]);
    });

    it("should remove policy priority when unchecked", async () => {
      const user = userEvent.setup();
      render(
        <CivicFieldsSection
          policyPriorities={["healthcare", "economy"]}
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      const healthcareLabel = screen.getByText("healthcare");
      await user.click(healthcareLabel);

      expect(mockOnChange).toHaveBeenCalledWith("policyPriorities", [
        "economy",
      ]);
    });

    it("should show selected priorities with styling", async () => {
      const user = userEvent.setup();
      render(
        <CivicFieldsSection
          policyPriorities={["healthcare"]}
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      // The healthcare label should have selected styling
      const healthcareLabel = screen.getByText("healthcare").closest("label");
      expect(healthcareLabel).toHaveClass("bg-blue-50");
    });
  });

  describe("disabled state", () => {
    it("should disable all form fields when disabled", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} disabled={true} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      expect(screen.getByLabelText("Political Affiliation")).toBeDisabled();
      expect(screen.getByLabelText("Voting Frequency")).toBeDisabled();
    });

    it("should not call onChange for checkboxes when disabled", async () => {
      const user = userEvent.setup();
      render(<CivicFieldsSection onChange={mockOnChange} disabled={true} />);

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      const healthcareLabel = screen.getByText("healthcare");
      await user.click(healthcareLabel);

      expect(mockOnChange).not.toHaveBeenCalled();
    });
  });

  describe("with various props", () => {
    it("should render with all props provided", async () => {
      const user = userEvent.setup();
      render(
        <CivicFieldsSection
          politicalAffiliation="independent"
          votingFrequency="every_election"
          policyPriorities={["healthcare", "economy"]}
          onChange={mockOnChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /civic information/i }),
      );

      expect(screen.getByLabelText("Political Affiliation")).toHaveValue(
        "independent",
      );
      expect(screen.getByLabelText("Voting Frequency")).toHaveValue(
        "every_election",
      );
    });
  });
});
