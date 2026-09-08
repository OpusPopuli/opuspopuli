/**
 * HeaderSearch behavioural tests (#1154 review).
 *
 * These cover the race the first cut of the feature shipped with: the
 * suggestion list changing underneath a held keyboard cursor. Driving
 * the Apollo mock and the debounce with fake timers is the only way to
 * hold that window open deterministically — an e2e attempt was verified
 * NOT to fail against the buggy code and was deleted rather than kept.
 *
 * Verified regression-proof: the first two FAIL against the pre-fix
 * component. The third (dangling aria-activedescendant) passes either
 * way — the stale-guard makes the dangling state unreachable — and is
 * kept as a standing invariant, not claimed as a regression test.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockedProvider } from "@apollo/client/testing/react";
import "@testing-library/jest-dom";

import { HeaderSearch } from "@/components/search/HeaderSearch";
import { REGION_SEARCH_SUGGEST } from "@/lib/graphql/region";

/** Mirrors SEARCH_DEBOUNCE_MS in the component. */
const SEARCH_DEBOUNCE_MS = 150;

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...a: unknown[]) => push(...a),
    replace: jest.fn(),
  }),
}));

function suggestion(id: string, label: string) {
  return {
    id,
    kind: "BILL",
    label,
    sublabel: "AB 1 · 2025-2026",
    __typename: "SearchSuggestion",
  };
}

/** "wildfire" resolves with 3 rows; "wildfirex" never resolves. */
const mocks = [
  {
    request: {
      query: REGION_SEARCH_SUGGEST,
      variables: { query: "wildfire", take: 8 },
    },
    result: {
      data: {
        regionSearchSuggest: [
          suggestion("b1", "First bill"),
          suggestion("b2", "Second bill"),
          suggestion("b3", "Third bill"),
        ],
      },
    },
  },
  {
    request: {
      query: REGION_SEARCH_SUGGEST,
      variables: { query: "wildfirex", take: 8 },
    },
    // Never settles: models the in-flight window during which the old
    // rows are gone and the new ones have not arrived.
    delay: 1_000_000,
    result: { data: { regionSearchSuggest: [] } },
  },
];

function renderSearch() {
  return render(
    <MockedProvider mocks={mocks}>
      <HeaderSearch />
    </MockedProvider>,
  );
}

function setupUser() {
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
}

/** Type a query and let its debounce + response settle. */
async function search(user: ReturnType<typeof setupUser>, text: string) {
  const input = screen.getByRole("combobox");
  await user.type(input, text);
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 50);
  });
  return input;
}

describe("HeaderSearch — stale suggestions (#1154 review)", () => {
  beforeEach(() => {
    push.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("drops the previous query's suggestions the moment the input changes", async () => {
    const user = setupUser();
    renderSearch();

    const input = await search(user, "wildfire");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));

    // One more character. `data` still holds the "wildfire" response for
    // the whole debounce window, so the rows used to stay on screen and
    // stay selectable for text the user had already replaced.
    await user.type(input, "x");

    // Only the "see all" row survives — the stale bills are gone at once.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByText("First bill")).not.toBeInTheDocument();
  });

  it("Enter during the in-flight window goes to the results page, never a stale bill", async () => {
    const user = setupUser();
    renderSearch();

    const input = await search(user, "wildfire");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));

    await user.type(input, "x");
    // Arrowing here used to land on a "wildfire" row and open that bill.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain("/region/search?q=");
    expect(push.mock.calls[0][0]).not.toContain("/region/bills/");
    // The component survived the keypress (no thrown handler).
    expect(input).toBeInTheDocument();
  });

  it("never points aria-activedescendant at a row that is not rendered", async () => {
    const user = setupUser();
    const { container } = renderSearch();

    const input = await search(user, "wildfire");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    await user.type(input, "x");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");

    const active = input.getAttribute("aria-activedescendant");
    if (active) {
      // A dangling IDREF is a WCAG 4.1.2 failure.
      expect(container.querySelector(`#${CSS.escape(active)}`)).not.toBeNull();
    }
  });
});
