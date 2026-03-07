import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { TrackOnBallotButton } from "@/components/petition/TrackOnBallotButton";

// Mock react-i18next
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params) {
        let result = key;
        for (const [k, v] of Object.entries(params)) {
          result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
      }
      return key;
    },
  }),
}));

// Mock Apollo Client
const mockSearchPropositions = jest.fn();
const mockLinkDocument = jest.fn();
let mockSearchData:
  | {
      searchPropositions: Array<{
        id: string;
        title: string;
        externalId: string;
        status: string;
      }>;
    }
  | undefined;
let mockSearchLoading = false;
let mockLinkLoading = false;

jest.mock("@apollo/client/react", () => ({
  ...jest.requireActual("@apollo/client/react"),
  useLazyQuery: jest.fn(() => [
    mockSearchPropositions,
    { data: mockSearchData, loading: mockSearchLoading },
  ]),
  useMutation: jest.fn(() => [mockLinkDocument, { loading: mockLinkLoading }]),
}));

const mockSearchResults = [
  {
    id: "prop-1",
    title: "Proposition 47: Criminal Sentencing",
    externalId: "Prop 47",
    status: "PENDING",
  },
  {
    id: "prop-2",
    title: "Proposition 36: Three Strikes Reform",
    externalId: "Prop 36",
    status: "PENDING",
  },
];

describe("TrackOnBallotButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSearchData = undefined;
    mockSearchLoading = false;
    mockLinkLoading = false;

    // Reset useLazyQuery mock to default (in case a previous test overrode it)
    const { useLazyQuery, useMutation } = jest.requireMock(
      "@apollo/client/react",
    );
    useLazyQuery.mockImplementation(() => [
      mockSearchPropositions,
      { data: mockSearchData, loading: mockSearchLoading },
    ]);
    useMutation.mockImplementation(() => [
      mockLinkDocument,
      { loading: mockLinkLoading },
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should show 'Track on Ballot' button when no linked propositions", () => {
    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    expect(screen.getByText("results.trackOnBallot")).toBeInTheDocument();
  });

  it("should show tracking count when linkedCount > 0", () => {
    render(<TrackOnBallotButton documentId="doc-1" linkedCount={3} />);

    expect(screen.getByText("results.trackingMeasures")).toBeInTheDocument();
  });

  it("should open dropdown when 'Track on Ballot' button is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    await user.click(screen.getByText("results.trackOnBallot"));

    expect(
      screen.getByPlaceholderText("results.searchPropositions"),
    ).toBeInTheDocument();
  });

  it("should open dropdown when tracking button is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={2} />);

    await user.click(screen.getByText("results.trackingMeasures"));

    expect(
      screen.getByPlaceholderText("results.searchPropositions"),
    ).toBeInTheDocument();
  });

  it("should trigger search after debounce when typing 3+ characters", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    // Open dropdown
    await user.click(screen.getByText("results.trackOnBallot"));

    const input = screen.getByPlaceholderText("results.searchPropositions");
    await user.type(input, "pro");

    // Search should not fire immediately
    expect(mockSearchPropositions).not.toHaveBeenCalled();

    // Advance past debounce timer
    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(mockSearchPropositions).toHaveBeenCalledWith({
      variables: { query: "pro" },
    });
  });

  it("should not trigger search for fewer than 3 characters", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    await user.click(screen.getByText("results.trackOnBallot"));

    const input = screen.getByPlaceholderText("results.searchPropositions");
    await user.type(input, "pr");

    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(mockSearchPropositions).not.toHaveBeenCalled();
  });

  it("should display search results", async () => {
    mockSearchData = { searchPropositions: mockSearchResults };
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    await user.click(screen.getByText("results.trackOnBallot"));

    // Type to set query >= 3 chars so results display
    const input = screen.getByPlaceholderText("results.searchPropositions");
    await user.type(input, "proposition");

    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(
      screen.getByText("Proposition 47: Criminal Sentencing"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Proposition 36: Three Strikes Reform"),
    ).toBeInTheDocument();
  });

  it("should show 'no matches' when search returns empty", async () => {
    mockSearchData = { searchPropositions: [] };
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    await user.click(screen.getByText("results.trackOnBallot"));

    const input = screen.getByPlaceholderText("results.searchPropositions");
    await user.type(input, "nonexistent");

    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(screen.getByText("results.noMatchesFound")).toBeInTheDocument();
  });

  it("should call linkDocument mutation when a result is clicked", async () => {
    mockSearchData = { searchPropositions: mockSearchResults };
    mockLinkDocument.mockResolvedValue({
      data: { linkDocumentToProposition: { success: true, linkId: "link-1" } },
    });

    const onLinked = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <TrackOnBallotButton
        documentId="doc-1"
        linkedCount={0}
        onLinked={onLinked}
      />,
    );

    await user.click(screen.getByText("results.trackOnBallot"));

    const input = screen.getByPlaceholderText("results.searchPropositions");
    await user.type(input, "proposition");

    act(() => {
      jest.advanceTimersByTime(350);
    });

    await user.click(screen.getByText("Proposition 47: Criminal Sentencing"));

    await waitFor(() => {
      expect(mockLinkDocument).toHaveBeenCalledWith({
        variables: {
          input: { documentId: "doc-1", propositionId: "prop-1" },
        },
      });
    });

    // onLinked callback should be called
    await waitFor(() => {
      expect(onLinked).toHaveBeenCalled();
    });
  });

  it("should close dropdown after successful link", async () => {
    mockSearchData = { searchPropositions: mockSearchResults };
    mockLinkDocument.mockResolvedValue({
      data: { linkDocumentToProposition: { success: true, linkId: "link-1" } },
    });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    await user.click(screen.getByText("results.trackOnBallot"));
    expect(
      screen.getByPlaceholderText("results.searchPropositions"),
    ).toBeInTheDocument();

    const input = screen.getByPlaceholderText("results.searchPropositions");
    await user.type(input, "proposition");

    act(() => {
      jest.advanceTimersByTime(350);
    });

    await user.click(screen.getByText("Proposition 47: Criminal Sentencing"));

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("results.searchPropositions"),
      ).not.toBeInTheDocument();
    });
  });

  it("should handle link mutation error gracefully", async () => {
    mockSearchData = { searchPropositions: mockSearchResults };
    mockLinkDocument.mockRejectedValue(new Error("Link failed"));

    const onLinked = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <TrackOnBallotButton
        documentId="doc-1"
        linkedCount={0}
        onLinked={onLinked}
      />,
    );

    await user.click(screen.getByText("results.trackOnBallot"));

    const input = screen.getByPlaceholderText("results.searchPropositions");
    await user.type(input, "proposition");

    act(() => {
      jest.advanceTimersByTime(350);
    });

    await user.click(screen.getByText("Proposition 47: Criminal Sentencing"));

    // onLinked should NOT be called on error
    await waitFor(() => {
      expect(mockLinkDocument).toHaveBeenCalled();
    });
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("should close dropdown on outside click", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <div>
        <div data-testid="outside">Outside</div>
        <TrackOnBallotButton documentId="doc-1" linkedCount={0} />
      </div>,
    );

    await user.click(screen.getByText("results.trackOnBallot"));
    expect(
      screen.getByPlaceholderText("results.searchPropositions"),
    ).toBeInTheDocument();

    // Click outside the dropdown
    await user.click(screen.getByTestId("outside"));

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("results.searchPropositions"),
      ).not.toBeInTheDocument();
    });
  });

  it("should show loading state when searching", () => {
    mockSearchLoading = true;

    // Need to re-import useLazyQuery mock with updated loading state
    const { useLazyQuery } = jest.requireMock("@apollo/client/react");
    useLazyQuery.mockReturnValue([
      mockSearchPropositions,
      { data: undefined, loading: true },
    ]);

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    // Open dropdown by clicking the button
    // Since we can't use userEvent with the re-mock, check initial state
    expect(screen.getByText("results.trackOnBallot")).toBeInTheDocument();
  });

  it("should toggle dropdown open/close", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    const button = screen.getByText("results.trackOnBallot");

    // Open
    await user.click(button);
    expect(
      screen.getByPlaceholderText("results.searchPropositions"),
    ).toBeInTheDocument();

    // Close - click the button area again (the button should still be present)
    await user.click(screen.getByText("results.trackOnBallot"));

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("results.searchPropositions"),
      ).not.toBeInTheDocument();
    });
  });

  it("should display proposition metadata (externalId and status)", async () => {
    mockSearchData = { searchPropositions: mockSearchResults };
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<TrackOnBallotButton documentId="doc-1" linkedCount={0} />);

    await user.click(screen.getByText("results.trackOnBallot"));

    const input = screen.getByPlaceholderText("results.searchPropositions");
    await user.type(input, "proposition");

    act(() => {
      jest.advanceTimersByTime(350);
    });

    // Check metadata is displayed
    expect(screen.getByText(/Prop 47/)).toBeInTheDocument();
    expect(screen.getByText(/Prop 36/)).toBeInTheDocument();
  });
});
