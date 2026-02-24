import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ReportIssueButton } from "@/components/ReportIssueButton";

// Mock react-i18next
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock toast
const mockShowToast = jest.fn();
jest.mock("@/lib/toast", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Mock Apollo Client
const mockSubmitReport = jest.fn();
let mockLoading = false;

jest.mock("@apollo/client/react", () => ({
  ...jest.requireActual("@apollo/client/react"),
  useMutation: () => [mockSubmitReport, { loading: mockLoading }],
}));

describe("ReportIssueButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoading = false;
    mockSubmitReport.mockResolvedValue({
      data: { submitAbuseReport: { success: true, reportId: "report-1" } },
    });
  });

  it("should render the report button", () => {
    render(<ReportIssueButton documentId="doc-123" />);

    expect(screen.getByText("report.button")).toBeInTheDocument();
  });

  it("should open the report panel when clicked", async () => {
    const user = userEvent.setup();
    render(<ReportIssueButton documentId="doc-123" />);

    await user.click(screen.getByText("report.button"));

    expect(screen.getByText("report.title")).toBeInTheDocument();
    expect(
      screen.getByText("report.reasons.incorrectAnalysis"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("report.reasons.offensiveContent"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("report.reasons.wrongDocumentType"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("report.reasons.privacyConcern"),
    ).toBeInTheDocument();
    expect(screen.getByText("report.reasons.other")).toBeInTheDocument();
  });

  it("should have submit button disabled until a reason is selected", async () => {
    const user = userEvent.setup();
    render(<ReportIssueButton documentId="doc-123" />);

    await user.click(screen.getByText("report.button"));

    const submitButton = screen.getByText("report.submit");
    expect(submitButton).toBeDisabled();

    // Select a reason
    await user.click(screen.getByText("report.reasons.incorrectAnalysis"));

    expect(submitButton).not.toBeDisabled();
  });

  it("should submit report with selected reason", async () => {
    const user = userEvent.setup();
    render(<ReportIssueButton documentId="doc-123" />);

    await user.click(screen.getByText("report.button"));
    await user.click(screen.getByText("report.reasons.incorrectAnalysis"));
    await user.click(screen.getByText("report.submit"));

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalledWith({
        variables: {
          input: {
            documentId: "doc-123",
            reason: "incorrect_analysis",
          },
        },
      });
    });

    expect(mockShowToast).toHaveBeenCalledWith("report.success", "success");
  });

  it("should submit report with reason and description", async () => {
    const user = userEvent.setup();
    render(<ReportIssueButton documentId="doc-123" />);

    await user.click(screen.getByText("report.button"));
    await user.click(screen.getByText("report.reasons.other"));

    const textarea = screen.getByPlaceholderText(
      "report.descriptionPlaceholder",
    );
    await user.type(textarea, "The summary is inaccurate");

    await user.click(screen.getByText("report.submit"));

    await waitFor(() => {
      expect(mockSubmitReport).toHaveBeenCalledWith({
        variables: {
          input: {
            documentId: "doc-123",
            reason: "other",
            description: "The summary is inaccurate",
          },
        },
      });
    });
  });

  it("should show 'Reported' state after successful submission", async () => {
    const user = userEvent.setup();
    render(<ReportIssueButton documentId="doc-123" />);

    await user.click(screen.getByText("report.button"));
    await user.click(screen.getByText("report.reasons.incorrectAnalysis"));
    await user.click(screen.getByText("report.submit"));

    await waitFor(() => {
      expect(screen.getByText("report.submitted")).toBeInTheDocument();
    });

    // Button should no longer be visible
    expect(screen.queryByText("report.button")).not.toBeInTheDocument();
  });

  it("should show warning toast for duplicate report", async () => {
    mockSubmitReport.mockRejectedValue(
      new Error("You have already reported this document."),
    );

    const user = userEvent.setup();
    render(<ReportIssueButton documentId="doc-123" />);

    await user.click(screen.getByText("report.button"));
    await user.click(screen.getByText("report.reasons.incorrectAnalysis"));
    await user.click(screen.getByText("report.submit"));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        "report.alreadyReported",
        "warning",
      );
    });

    // Should still show reported state
    expect(screen.getByText("report.submitted")).toBeInTheDocument();
  });

  it("should show error toast on general failure", async () => {
    mockSubmitReport.mockRejectedValue(new Error("Server error"));

    const user = userEvent.setup();
    render(<ReportIssueButton documentId="doc-123" />);

    await user.click(screen.getByText("report.button"));
    await user.click(screen.getByText("report.reasons.incorrectAnalysis"));
    await user.click(screen.getByText("report.submit"));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith("report.error", "error");
    });

    // Should still show the report button (not reported state)
    expect(screen.getByText("report.title")).toBeInTheDocument();
  });
});
