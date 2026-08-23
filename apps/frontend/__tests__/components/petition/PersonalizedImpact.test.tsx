import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PersonalizedImpact } from "@/components/petition/PersonalizedImpact";
import {
  coarseRegionLabel,
  trueFlagNames,
} from "@/components/petition/usePersonalizedImpact";
import type { PersonalizedImpactResult } from "@/lib/graphql/documents";

// Mock react-i18next
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        let result = key;
        for (const [k, v] of Object.entries(params)) {
          result = result.replace(`{{${k}}}`, v);
        }
        return result;
      }
      return key;
    },
  }),
}));

const impact: PersonalizedImpactResult = {
  text: "As a renter in your area, this measure would cap your annual rent increase at 5%.",
  provider: "Ollama",
  model: "qwen3.5:9b",
  promptVersion: "v1",
  fromCache: false,
};

describe("PersonalizedImpact", () => {
  it("renders nothing when absent — the generic analysis is the fallback", () => {
    const { container } = render(
      <PersonalizedImpact status="absent" impact={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the sign-in nudge for anonymous scanners", () => {
    render(<PersonalizedImpact status="anonymous" impact={null} />);

    expect(
      screen.getByText("results.personalizedSignInTitle"),
    ).toBeInTheDocument();
    const cta = screen.getByRole("link", {
      name: "results.personalizedSignInCta",
    });
    expect(cta).toHaveAttribute("href", "/login");
  });

  it("marks the section busy while personalizing", () => {
    render(<PersonalizedImpact status="loading" impact={null} />);

    expect(screen.getByText("results.personalizedLoading")).toBeInTheDocument();
  });

  it("leads with the personalized read and labels it as AI-generated", () => {
    render(<PersonalizedImpact status="ready" impact={impact} />);

    expect(
      screen.getByRole("heading", { name: /results.personalizedTitle/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(impact.text)).toBeInTheDocument();
    expect(screen.getByText(/results.personalizedAiLabel/)).toBeInTheDocument();
    // Provider attribution rides on the existing analyzedBy key.
    expect(screen.getByText(/results.analyzedBy/)).toBeInTheDocument();
  });
});

describe("coarseRegionLabel", () => {
  it("keeps only the first two digits of a postal code", () => {
    expect(coarseRegionLabel("94110")).toBe("94xxx");
    expect(coarseRegionLabel("94110-1234")).toBe("94xxx");
    expect(coarseRegionLabel(" 95814 ")).toBe("95xxx");
  });

  it("yields undefined for short, non-numeric, or missing codes", () => {
    expect(coarseRegionLabel("941")).toBeUndefined();
    expect(coarseRegionLabel("SW1A 1AA")).toBeUndefined();
    expect(coarseRegionLabel(null)).toBeUndefined();
    expect(coarseRegionLabel(undefined)).toBeUndefined();
  });
});

describe("trueFlagNames", () => {
  it("returns only the TRUE flag names, dropping __typename", () => {
    expect(
      trueFlagNames({
        __typename: "RankingFlags",
        isRenter: true,
        isVeteran: false,
        isParent: true,
      }),
    ).toEqual(["isRenter", "isParent"]);
  });

  it("handles null and empty flags", () => {
    expect(trueFlagNames(null)).toEqual([]);
    expect(trueFlagNames(undefined)).toEqual([]);
    expect(trueFlagNames({})).toEqual([]);
  });
});
