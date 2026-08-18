import { render, screen } from "@testing-library/react";
import { PersonalizationProgress } from "@/components/briefing/PersonalizationProgress";

const mockRefetchQueries = jest.fn().mockResolvedValue([]);
const mockStopPolling = jest.fn();
let mockData: unknown = undefined;

jest.mock("@apollo/client/react", () => ({
  useQuery: () => ({ data: mockData, stopPolling: mockStopPolling }),
  useApolloClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

/**
 * Status values here are UPPERCASE on purpose — that is what the GraphQL enum
 * actually serialises. The first version of this component compared against
 * the lowercase spelling used by the database column, so `pending` was always
 * zero and the notice rendered nothing at all while the jobs it reported on
 * ran perfectly. Tests that used the database spelling would have passed.
 */
const now = () => new Date().toISOString();

describe("PersonalizationProgress", () => {
  beforeEach(() => {
    mockData = undefined;
    mockRefetchQueries.mockClear();
    mockStopPolling.mockClear();
  });

  it("shows the notice while jobs are QUEUED or RUNNING (uppercase, as the API sends)", () => {
    mockData = {
      myRecentLlmRerankJobs: [
        {
          jobId: "1",
          status: "SUCCEEDED",
          enqueuedAt: now(),
          finishedAt: now(),
        },
        { jobId: "2", status: "RUNNING", enqueuedAt: now(), finishedAt: null },
        { jobId: "3", status: "QUEUED", enqueuedAt: now(), finishedAt: null },
      ],
    };

    render(<PersonalizationProgress />);

    expect(screen.getByText("personalizing.title")).toBeInTheDocument();
    // 1 of 3 finished.
    expect(
      screen.getByText('personalizing.progress:{"done":1,"total":3}'),
    ).toBeInTheDocument();
  });

  it("also accepts the lowercase spelling, so neither casing can break it", () => {
    mockData = {
      myRecentLlmRerankJobs: [
        { jobId: "1", status: "running", enqueuedAt: now(), finishedAt: null },
      ],
    };

    render(<PersonalizationProgress />);

    expect(screen.getByText("personalizing.title")).toBeInTheDocument();
  });

  it("renders nothing once every job has finished", () => {
    mockData = {
      myRecentLlmRerankJobs: [
        {
          jobId: "1",
          status: "SUCCEEDED",
          enqueuedAt: now(),
          finishedAt: now(),
        },
      ],
    };

    const { container } = render(<PersonalizationProgress />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a returning user with no recent run", () => {
    const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockData = {
      myRecentLlmRerankJobs: [
        {
          jobId: "1",
          status: "RUNNING",
          enqueuedAt: longAgo,
          finishedAt: null,
        },
      ],
    };

    const { container } = render(<PersonalizationProgress />);

    // Outside the run window — history, not progress.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the query returned nothing", () => {
    mockData = undefined;

    const { container } = render(<PersonalizationProgress />);

    expect(container).toBeEmptyDOMElement();
  });
  describe("polling lifecycle", () => {
    /*
     * The query polls every 15s with fetchPolicy network-only. Left running it
     * is a permanent background request per open tab, for every user
     * including returning ones with no active run -- on a platform that
     * already issues ~21 requests per briefing load and rate-limits per IP.
     */
    it("stops polling when nothing is pending", () => {
      mockData = {
        myRecentLlmRerankJobs: [
          {
            jobId: "1",
            status: "SUCCEEDED",
            enqueuedAt: now(),
            finishedAt: now(),
          },
        ],
      };

      render(<PersonalizationProgress />);

      expect(mockStopPolling).toHaveBeenCalled();
    });

    it("stops polling for a returning user with no run at all", () => {
      mockData = { myRecentLlmRerankJobs: [] };

      render(<PersonalizationProgress />);

      expect(mockStopPolling).toHaveBeenCalled();
    });

    it("keeps polling while work is outstanding", () => {
      mockData = {
        myRecentLlmRerankJobs: [
          {
            jobId: "1",
            status: "RUNNING",
            enqueuedAt: now(),
            finishedAt: null,
          },
        ],
      };

      render(<PersonalizationProgress />);

      expect(mockStopPolling).not.toHaveBeenCalled();
    });
  });
});
