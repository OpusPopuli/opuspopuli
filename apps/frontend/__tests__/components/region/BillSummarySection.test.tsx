import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BillSummarySection } from "@/components/region/BillSummarySection";

let mockAuthenticated = false;
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: mockAuthenticated, isLoading: false }),
}));

const mockRequest = jest.fn();
/** What the section's own status query returns; undefined = loading/failed. */
let mockStatus: string | undefined;
const mockUseQuery = jest.fn();
const mockClientQuery = jest.fn().mockResolvedValue({});
jest.mock("@apollo/client/react", () => ({
  useApolloClient: () => ({ query: mockClientQuery }),
  useMutation: () => [mockRequest, { loading: false }],
  useQuery: (...args: unknown[]) => {
    mockUseQuery(...args);
    return {
      data: mockStatus ? { billSummaryStatus: mockStatus } : undefined,
    };
  },
}));

const answer = (status: string) =>
  mockRequest.mockResolvedValue({ data: { requestBillSummary: status } });
const lastPoll = () =>
  (mockUseQuery.mock.calls.at(-1)![1] as { pollInterval: number }).pollInterval;
/** A fresh element each time: the same one lets React skip the render. */
const section = (hasSummary = false) => (
  <BillSummarySection billId="b1" hasSummary={hasSummary} />
);

describe("BillSummarySection (bills-phase-b.md D7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticated = false;
    mockStatus = "MISSING";
    answer("PENDING");
  });

  it("gives an anonymous reader a button, and asks only when pressed", async () => {
    render(section());
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

  it("asks once for a signed-in reader, even when the status moves", async () => {
    mockAuthenticated = true;
    const { rerender } = render(section());
    await act(async () => {});
    mockStatus = "PENDING";
    rerender(section());
    mockStatus = "MISSING";
    rerender(section());
    await act(async () => {});

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps a stale summary on screen and offers an update", () => {
    mockStatus = "STALE";
    render(
      <BillSummarySection billId="b1" hasSummary>
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
    render(section());
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/isn’t available/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("polls after a request, and stops once the summary lands", async () => {
    const { rerender } = render(section());
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(lastPoll()).toBe(15_000);

    mockStatus = "CURRENT";
    rerender(section(true));
    await act(async () => {});

    expect(lastPoll()).toBe(0);
  });

  it("does not take the status from before the request for its outcome", async () => {
    // Right after the request the query still holds MISSING; the wait must
    // go on until a poll says how it ended.
    const { rerender } = render(section());
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    rerender(section());
    await act(async () => {});

    expect(lastPoll()).toBe(15_000);
    expect(screen.getByRole("status")).toHaveTextContent(/preparing/i);
  });

  it("polls when the page opens on a summary already being written", async () => {
    mockStatus = "PENDING";
    const { rerender } = render(section());
    await act(async () => {});
    rerender(section());
    expect(lastPoll()).toBe(15_000);

    mockStatus = "CURRENT";
    rerender(section(true));
    await act(async () => {});
    expect(lastPoll()).toBe(0);
  });

  it("does not poll when nothing is pending", async () => {
    mockStatus = "CURRENT";
    render(section(true));
    await act(async () => {});
    expect(lastPoll()).toBe(0);
  });

  it("stops promising a summary after the bounded wait", async () => {
    jest.useFakeTimers();
    try {
      mockStatus = "PENDING";
      render(section());
      await act(async () => {});
      act(() => {
        jest.advanceTimersByTime(15_000 * 8);
      });
      expect(screen.getByRole("status")).toHaveTextContent(
        /longer than usual/i,
      );
      expect(lastPoll()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("says when a bill has no summary to give", () => {
    mockStatus = "CURRENT";
    render(section());
    expect(screen.getByRole("status")).toHaveTextContent(
      /no plain-language summary is available/i,
    );
  });

  it("stays quiet, with no button, when its status query fails", () => {
    mockStatus = undefined;
    render(section());
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("fetches a summary the batch wrote after the page loaded", async () => {
    answer("CURRENT");
    render(section());
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
    render(section());
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("status")).toHaveFocus();
  });
});
