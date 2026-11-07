import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BillSummarySection } from "@/components/region/BillSummarySection";

let mockAuthenticated = false;
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: mockAuthenticated, isLoading: false }),
}));

const mockRequest = jest.fn();
let mockPolled: { billSummaryStatus: string } | undefined;
const mockUseQuery = jest.fn();
const mockClientQuery = jest.fn().mockResolvedValue({});
jest.mock("@apollo/client/react", () => ({
  useApolloClient: () => ({ query: mockClientQuery }),
  useMutation: () => [mockRequest, { loading: false }],
  useQuery: (...args: unknown[]) => {
    mockUseQuery(...args);
    return { data: mockPolled };
  },
}));

const answer = (status: string) =>
  mockRequest.mockResolvedValue({ data: { requestBillSummary: status } });

describe("BillSummarySection (bills-phase-b.md D7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticated = false;
    mockPolled = undefined;
    answer("PENDING");
  });

  it("gives an anonymous reader a button, and asks only when pressed", async () => {
    render(
      <BillSummarySection billId="b1" status="MISSING" hasSummary={false} />,
    );
    expect(mockRequest).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /summarize this bill/i }),
      );
    });

    expect(mockRequest).toHaveBeenCalledWith({ variables: { billId: "b1" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      /preparing a plain-language summary/i,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("asks once for a signed-in reader, with no button", async () => {
    mockAuthenticated = true;
    const { rerender } = render(
      <BillSummarySection billId="b1" status="MISSING" hasSummary={false} />,
    );
    await act(async () => {});
    // The status moves under the page (a failed attempt reads MISSING again):
    // the page must not ask a second time.
    rerender(
      <BillSummarySection billId="b1" status="PENDING" hasSummary={false} />,
    );
    rerender(
      <BillSummarySection billId="b1" status="MISSING" hasSummary={false} />,
    );
    await act(async () => {});

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps a stale summary on screen and offers an update", () => {
    render(
      <BillSummarySection billId="b1" status="STALE" hasSummary>
        <p>The old summary.</p>
      </BillSummarySection>,
    );
    expect(screen.getByText("The old summary.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/earlier version/i);
    expect(
      screen.getByRole("button", { name: /update the summary/i }),
    ).toBeInTheDocument();
  });

  it("says when a summary cannot be had, and offers nothing", async () => {
    answer("UNAVAILABLE");
    render(
      <BillSummarySection billId="b1" status="MISSING" hasSummary={false} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/isn’t available/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("stops polling once a requested summary lands", async () => {
    // A fresh element each time: the same one lets React skip the render.
    const view = () => (
      <BillSummarySection billId="b1" status="MISSING" hasSummary={false} />
    );
    const { rerender } = render(view());
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    const polling = mockUseQuery.mock.calls.at(-1)![1] as { skip: boolean };
    expect(polling.skip).toBe(false);

    // The next poll finds it written.
    mockPolled = { billSummaryStatus: "CURRENT" };
    rerender(view());
    await act(async () => {});

    const after = mockUseQuery.mock.calls.at(-1)![1] as {
      skip: boolean;
      pollInterval: number;
    };
    expect(after.skip).toBe(true);
    expect(after.pollInterval).toBe(0);
  });

  it("settles on the polled answer, so polling stops", async () => {
    mockPolled = { billSummaryStatus: "CURRENT" };
    render(<BillSummarySection billId="b1" status="PENDING" hasSummary />);
    await act(async () => {});

    const opts = mockUseQuery.mock.calls.at(-1)![1] as {
      skip: boolean;
      pollInterval: number;
    };
    expect(opts.skip).toBe(true);
    expect(opts.pollInterval).toBe(0);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("fetches a summary the batch wrote after the page loaded", async () => {
    answer("CURRENT");
    render(
      <BillSummarySection billId="b1" status="MISSING" hasSummary={false} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { id: "b1" },
        fetchPolicy: "network-only",
      }),
    );
  });

  it("moves focus to the status once the button is gone", async () => {
    render(
      <BillSummarySection billId="b1" status="MISSING" hasSummary={false} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("does not poll when nothing is pending", () => {
    render(<BillSummarySection billId="b1" status="CURRENT" hasSummary />);
    const opts = mockUseQuery.mock.calls.at(-1)![1] as {
      skip: boolean;
      pollInterval: number;
    };
    expect(opts.skip).toBe(true);
  });

  it("stops promising a summary after the bounded wait", () => {
    jest.useFakeTimers();
    try {
      render(
        <BillSummarySection billId="b1" status="PENDING" hasSummary={false} />,
      );
      act(() => {
        jest.advanceTimersByTime(15_000 * 8);
      });
      expect(screen.getByRole("status")).toHaveTextContent(
        /longer than usual/i,
      );
      const opts = mockUseQuery.mock.calls.at(-1)![1] as {
        pollInterval: number;
      };
      expect(opts.pollInterval).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("says when a bill has no summary to give", () => {
    render(
      <BillSummarySection billId="b1" status="CURRENT" hasSummary={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /no plain-language summary is available/i,
    );
  });
});
