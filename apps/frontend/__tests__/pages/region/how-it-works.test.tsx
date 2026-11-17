import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";

import type { CivicsBlock } from "@/lib/graphql/region";

/**
 * The how-it-works page lists a receipt for every official page its civics
 * text was extracted from (#1450). Civics data is merged across pages, so a
 * single receipt could not be true of all of it.
 */

let mockCivics: CivicsBlock | null = null;

jest.mock("@/components/civics/CivicsContext", () => ({
  useCivics: () => ({
    civics: mockCivics,
    loading: false,
    glossaryByTerm: new Map(),
  }),
}));
jest.mock("@/components/civics/MeasureTypeTable", () => ({
  MeasureTypeTable: () => null,
}));
jest.mock("@/components/civics/HowABillBecomesLaw", () => ({
  HowABillBecomesLaw: () => null,
}));
jest.mock("@/components/civics/GlossaryList", () => ({
  GlossaryList: () => null,
}));

// Imported after the mocks.
import HowItWorksPage from "@/app/region/how-it-works/page";

const civics = (sources: CivicsBlock["sources"]): CivicsBlock => ({
  chambers: [],
  measureTypes: [],
  lifecycleStages: [],
  glossary: [
    {
      term: "Engrossed",
      slug: "engrossed",
      definition: {
        verbatim: "V",
        plainLanguage: "P",
        sourceUrl: "https://example.gov/glossary",
      },
      relatedTerms: [],
    } as unknown as CivicsBlock["glossary"][number],
  ],
  sources,
});

describe("HowItWorksPage — sources", () => {
  it("lists one receipt per source page", () => {
    mockCivics = civics([
      {
        kind: "AI",
        promptHash: "f5".repeat(32),
        sourceUrl: "https://www.assembly.ca.gov/how-a-bill",
      },
      { kind: "AI", sourceUrl: "https://example.gov/glossary" },
    ]);
    render(<HowItWorksPage />);

    const section = screen.getByRole("region", {
      name: "Where this comes from",
    });
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(within(section).getAllByText("How this was made")).toHaveLength(2);
  });

  it("shows no sources section when none are loaded", () => {
    mockCivics = civics([]);
    render(<HowItWorksPage />);
    expect(
      screen.queryByRole("region", { name: "Where this comes from" }),
    ).toBeNull();
  });
});
