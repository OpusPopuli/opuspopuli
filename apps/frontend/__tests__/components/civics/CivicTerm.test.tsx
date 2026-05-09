import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CivicTerm } from "@/components/civics/CivicTerm";
import type {
  CivicsGlossaryEntry,
  CivicsMeasureType,
} from "@/lib/graphql/region";

const makeGlossaryEntry = (
  overrides: Partial<CivicsGlossaryEntry> = {},
): CivicsGlossaryEntry => ({
  term: "Engrossed",
  slug: "engrossed",
  definition: {
    verbatim: "A bill passed by one chamber.",
    plainLanguage: "A bill passed by one chamber in plain language.",
    sourceUrl: "https://example.gov",
  },
  relatedTerms: [],
  ...overrides,
});

const makeMeasureType = (
  overrides: Partial<CivicsMeasureType> = {},
): CivicsMeasureType => ({
  code: "AB",
  name: "Assembly Bill",
  chamber: "Assembly",
  votingThreshold: "majority",
  reachesGovernor: true,
  purpose: {
    verbatim: "A draft of a proposed law.",
    plainLanguage: "A draft of a proposed law for the Assembly.",
    sourceUrl: "https://example.gov",
  },
  lifecycleStageIds: [],
  ...overrides,
});

// Mock useCivics
const mockCivicsContext = {
  civics: null,
  glossaryMap: new Map<string, CivicsGlossaryEntry>(),
  glossaryByTerm: new Map<string, CivicsGlossaryEntry>(),
  measureTypeByCode: new Map<string, CivicsMeasureType>(),
  loading: false,
};

jest.mock("@/components/civics/CivicsContext", () => ({
  useCivics: () => mockCivicsContext,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

beforeEach(() => {
  mockCivicsContext.glossaryMap = new Map();
  mockCivicsContext.glossaryByTerm = new Map();
  mockCivicsContext.measureTypeByCode = new Map();
  mockCivicsContext.loading = false;
});

describe("CivicTerm", () => {
  it("renders children unchanged when term is not in glossary or measure types", () => {
    render(<CivicTerm term="unknown-term">Some text</CivicTerm>);
    expect(screen.getByText("Some text")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders children during loading without tooltip", () => {
    mockCivicsContext.loading = true;
    render(<CivicTerm term="unknown">Loading state</CivicTerm>);
    expect(screen.getByText("Loading state")).toBeInTheDocument();
  });

  it("shows tooltip when term is found by slug", () => {
    const entry = makeGlossaryEntry();
    mockCivicsContext.glossaryMap.set("engrossed", entry);
    render(<CivicTerm term="engrossed">Engrossed</CivicTerm>);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "A bill passed by one chamber in plain language.",
    );
  });

  it("shows tooltip when term is found by lowercase term text", () => {
    const entry = makeGlossaryEntry();
    mockCivicsContext.glossaryByTerm.set("engrossed", entry);
    render(<CivicTerm term="Engrossed">Engrossed</CivicTerm>);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("shows tooltip with measure type purpose when code matches", () => {
    const mt = makeMeasureType();
    mockCivicsContext.measureTypeByCode.set("AB", mt);
    render(<CivicTerm term="AB">AB 1234</CivicTerm>);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "A draft of a proposed law for the Assembly.",
    );
  });

  it("prefers glossary entry over measure type code", () => {
    const entry = makeGlossaryEntry({ term: "AB", slug: "ab" });
    mockCivicsContext.glossaryByTerm.set("ab", entry);
    const mt = makeMeasureType();
    mockCivicsContext.measureTypeByCode.set("AB", mt);
    render(<CivicTerm term="AB">AB</CivicTerm>);
    // Glossary definition should win
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "A bill passed by one chamber in plain language.",
    );
  });

  it("includes Learn more link for glossary entries", () => {
    const entry = makeGlossaryEntry();
    mockCivicsContext.glossaryMap.set("engrossed", entry);
    render(<CivicTerm term="engrossed">Engrossed</CivicTerm>);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/region/how-it-works#term-engrossed");
  });

  it("does not include Learn more link for measure type lookups", () => {
    const mt = makeMeasureType();
    mockCivicsContext.measureTypeByCode.set("AB", mt);
    render(<CivicTerm term="AB">AB</CivicTerm>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
