/**
 * WCAG 2.2 AA accessibility tests for the header search combobox
 * (#1154). The full results page is covered by the e2e axe scan
 * (e2e/region-search.spec.ts); this targets the new interactive
 * combobox surface specifically — the WAI-ARIA pattern wiring
 * (combobox/listbox/option roles, aria-expanded, activedescendant).
 */

import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { MockedProvider } from "@apollo/client/testing/react";
import "@testing-library/jest-dom";

import { HeaderSearch } from "@/components/search/HeaderSearch";
import { REGION_SEARCH_SUGGEST } from "@/lib/graphql/region";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const suggestMock = {
  request: {
    query: REGION_SEARCH_SUGGEST,
    variables: { query: "ab 12", take: 8 },
  },
  result: {
    data: {
      regionSearchSuggest: [
        {
          id: "bill-1",
          kind: "DIRECT",
          label: "Residential property insurance: wildfire risk",
          sublabel: "AB 1236 · 2025-2026",
          __typename: "SearchSuggestion",
        },
        {
          id: "prop-1",
          kind: "PROPOSITION",
          label: "Wildfire Response Bond Act",
          sublabel: "Proposition 12",
          __typename: "SearchSuggestion",
        },
      ],
    },
  },
};

function renderSearch() {
  return render(
    <MockedProvider mocks={[suggestMock]}>
      <HeaderSearch />
    </MockedProvider>,
  );
}

describe("HeaderSearch a11y (#1154)", () => {
  it("has no axe violations in the idle state", async () => {
    const { container } = renderSearch();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with the listbox open", async () => {
    const user = userEvent.setup();
    const { container, findByRole } = renderSearch();

    await user.type(container.querySelector("input")!, "ab 12");
    await findByRole("option", { name: /wildfire risk/i });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("wires the combobox pattern: expanded state and activedescendant follow the keyboard", async () => {
    const user = userEvent.setup();
    const { container, findByRole, getByRole } = renderSearch();
    const input = getByRole("combobox");

    expect(input).toHaveAttribute("aria-expanded", "false");

    await user.type(input, "ab 12");
    await findByRole("option", { name: /wildfire risk/i });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    await user.keyboard("{ArrowDown}");
    const active = input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    const activeOption = container.querySelector(`#${CSS.escape(active!)}`);
    expect(activeOption).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});
