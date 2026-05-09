import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { GlossaryList } from "@/components/civics/GlossaryList";
import type { CivicsGlossaryEntry } from "@/lib/graphql/region";

const mockGlossaryByTerm = new Map<string, CivicsGlossaryEntry>();

jest.mock("@/components/civics/CivicsContext", () => ({
  useCivics: () => ({ glossaryByTerm: mockGlossaryByTerm }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.query ? `No terms match "${opts.query}".` : key,
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

const makeEntry = (
  term: string,
  slug: string,
  overrides: Partial<CivicsGlossaryEntry> = {},
): CivicsGlossaryEntry => ({
  term,
  slug,
  definition: {
    verbatim: `${term} verbatim definition`,
    plainLanguage: `${term} plain definition`,
    sourceUrl: "https://example.gov",
  },
  relatedTerms: [],
  ...overrides,
});

const ENTRIES: CivicsGlossaryEntry[] = [
  makeEntry("Engrossed", "engrossed"),
  makeEntry("Committee", "committee"),
  makeEntry("Chaptered", "chaptered"),
];

beforeEach(() => {
  mockGlossaryByTerm.clear();
  ENTRIES.forEach((e) => mockGlossaryByTerm.set(e.term.toLowerCase(), e));
});

describe("GlossaryList", () => {
  it("renders all entries when query is empty", () => {
    render(<GlossaryList entries={ENTRIES} />);
    expect(screen.getByText("Engrossed")).toBeInTheDocument();
    expect(screen.getByText("Committee")).toBeInTheDocument();
    expect(screen.getByText("Chaptered")).toBeInTheDocument();
  });

  it("filters entries by term (case-insensitive)", async () => {
    render(<GlossaryList entries={ENTRIES} />);
    await userEvent.type(screen.getByRole("searchbox"), "engr");
    expect(screen.getByText("Engrossed")).toBeInTheDocument();
    expect(screen.queryByText("Committee")).not.toBeInTheDocument();
  });

  it("filters entries by definition text", async () => {
    render(<GlossaryList entries={ENTRIES} />);
    await userEvent.type(screen.getByRole("searchbox"), "chaptered plain");
    expect(screen.getByText("Chaptered")).toBeInTheDocument();
    expect(screen.queryByText("Engrossed")).not.toBeInTheDocument();
  });

  it("shows empty state when no entries match", async () => {
    render(<GlossaryList entries={ENTRIES} />);
    await userEvent.type(screen.getByRole("searchbox"), "zzznomatch");
    expect(screen.getByText(/No terms match/)).toBeInTheDocument();
  });

  it("gives each entry the correct anchor id matching its slug", () => {
    render(<GlossaryList entries={ENTRIES} />);
    expect(document.getElementById("term-engrossed")).toBeInTheDocument();
    expect(document.getElementById("term-committee")).toBeInTheDocument();
  });

  it("uses real slug from glossaryByTerm for related term links", () => {
    const entryWithRelated = makeEntry("Engrossed", "engrossed", {
      relatedTerms: ["Committee"],
    });
    render(<GlossaryList entries={[entryWithRelated]} />);
    const link = screen.getByRole("link", { name: "Committee" });
    // glossaryByTerm has "committee" → slug "committee"
    expect(link).toHaveAttribute("href", "#term-committee");
  });

  it("falls back to derived slug when term not in glossaryByTerm", () => {
    const entryWithRelated = makeEntry("Engrossed", "engrossed", {
      relatedTerms: ["Unknown Term"],
    });
    render(<GlossaryList entries={[entryWithRelated]} />);
    const link = screen.getByRole("link", { name: "Unknown Term" });
    expect(link).toHaveAttribute("href", "#term-unknown-term");
  });
});
