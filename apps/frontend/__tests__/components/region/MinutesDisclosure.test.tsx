import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { MinutesDisclosure } from "@/components/region/MinutesDisclosure";
import type { Minutes } from "@/lib/graphql/region";

const mockLoad = jest.fn();
let lazyState: {
  data?: { minutes: Minutes | null };
  loading: boolean;
  error?: Error;
  called: boolean;
};

jest.mock("@apollo/client/react", () => ({
  useLazyQuery: () => [mockLoad, lazyState],
}));

function renderDisclosure(minutesId = "min-1") {
  return render(<MinutesDisclosure minutesId={minutesId} />);
}

function minutes(over: Partial<Minutes> = {}): Minutes {
  return {
    id: "min-1",
    externalId: "assembly-2026-07-03",
    body: "Assembly",
    date: "2026-07-03",
    summary: "The committee advanced two bills and heard public comment.",
    claims: [],
    sourceUrl: "https://example.gov/j.pdf",
    ...over,
  };
}

beforeEach(() => {
  mockLoad.mockClear();
  lazyState = {
    data: undefined,
    loading: false,
    error: undefined,
    called: false,
  };
});

describe("MinutesDisclosure (#932)", () => {
  it("is collapsed by default and does not fire the query until expanded", () => {
    renderDisclosure();
    const button = screen.getByRole("button", {
      name: /session synopsis & concerns/i,
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(mockLoad).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/the committee advanced/i),
    ).not.toBeInTheDocument();
  });

  it("lazy-loads minutes(id) on expand", async () => {
    const user = userEvent.setup();
    renderDisclosure("min-42");
    await user.click(screen.getByRole("button"));
    expect(mockLoad).toHaveBeenCalledWith({ variables: { id: "min-42" } });
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("renders the synopsis, concern badge and claims once loaded", async () => {
    const user = userEvent.setup();
    lazyState.data = {
      minutes: minutes({
        claims: [
          {
            kind: "CONCERN",
            title: "Objection raised",
            detail: "A member flagged costs.",
            citation: { quote: "unfunded" },
            billRefs: ["AB 1"],
            severity: "HIGH",
          },
        ],
      }),
    };
    renderDisclosure();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/the committee advanced/i)).toBeInTheDocument();
    expect(screen.getByText("1 concern")).toBeInTheDocument();
    expect(screen.getByText("Objection raised")).toBeInTheDocument();
    expect(screen.getByText("AB 1")).toBeInTheDocument();
  });

  it("shows the empty state when nothing was generated", async () => {
    const user = userEvent.setup();
    lazyState.data = { minutes: minutes({ summary: undefined, claims: [] }) };
    renderDisclosure();
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/no ai synopsis has been generated/i),
    ).toBeInTheDocument();
  });

  it("shows a loading message while the query is in flight", async () => {
    const user = userEvent.setup();
    lazyState.loading = true;
    renderDisclosure();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/loading synopsis/i)).toBeInTheDocument();
  });

  it("shows an error message when the query fails", async () => {
    const user = userEvent.setup();
    lazyState.error = new Error("boom");
    renderDisclosure();
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText(/couldn't load the session synopsis/i),
    ).toBeInTheDocument();
  });
});
