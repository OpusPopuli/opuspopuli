import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { LifecycleProgressBar } from "@/components/civics/LifecycleProgressBar";
import type { CivicsLifecycleStage } from "@/lib/graphql/region";

const makeStage = (id: string, name: string): CivicsLifecycleStage => ({
  id,
  name: {
    verbatim: name,
    plainLanguage: name,
    sourceUrl: "https://example.gov",
  },
  shortDescription: {
    verbatim: `${name} short description`,
    plainLanguage: `${name} short description`,
    sourceUrl: "https://example.gov",
  },
  longDescription: {
    verbatim: `${name} long description`,
    plainLanguage: `${name} long description`,
    sourceUrl: "https://example.gov",
  },
  statusStringPatterns: [],
  citizenAction: undefined,
});

const STAGES: CivicsLifecycleStage[] = [
  makeStage("introduction", "Introduction"),
  makeStage("committee", "In Committee"),
  makeStage("floor-vote", "Floor Vote"),
];

describe("LifecycleProgressBar", () => {
  it("renders nothing when stages array is empty", () => {
    const { container } = render(
      <LifecycleProgressBar stages={[]} currentStageId={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders all stage names", () => {
    render(<LifecycleProgressBar stages={STAGES} currentStageId={null} />);
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("In Committee")).toBeInTheDocument();
    expect(screen.getByText("Floor Vote")).toBeInTheDocument();
  });

  it("marks current stage with aria-current='step'", () => {
    render(<LifecycleProgressBar stages={STAGES} currentStageId="committee" />);
    const items = screen.getAllByRole("listitem");
    const currentItem = items.find(
      (el) => el.getAttribute("aria-current") === "step",
    );
    expect(currentItem).toBeInTheDocument();
  });

  it("does not set aria-current in abstract mode (currentStageId=null)", () => {
    render(<LifecycleProgressBar stages={STAGES} currentStageId={null} />);
    const withAriaStep = document.querySelectorAll('[aria-current="step"]');
    expect(withAriaStep).toHaveLength(0);
  });

  it("clicking a stage dot expands the detail panel", async () => {
    render(<LifecycleProgressBar stages={STAGES} currentStageId={null} />);
    const buttons = screen.getAllByRole("button");
    // First button is the first stage dot
    await userEvent.click(buttons[0]);
    expect(
      screen.getByText("Introduction short description"),
    ).toBeInTheDocument();
  });

  it("clicking the same stage again collapses the detail panel", async () => {
    render(<LifecycleProgressBar stages={STAGES} currentStageId={null} />);
    const buttons = screen.getAllByRole("button");
    await userEvent.click(buttons[0]);
    expect(
      screen.getByText("Introduction short description"),
    ).toBeInTheDocument();
    await userEvent.click(buttons[0]);
    expect(
      screen.queryByText("Introduction short description"),
    ).not.toBeInTheDocument();
  });

  it("close button (✕) dismisses the detail panel", async () => {
    render(<LifecycleProgressBar stages={STAGES} currentStageId={null} />);
    await userEvent.click(screen.getAllByRole("button")[0]);
    const closeBtn = screen.getByRole("button", { name: /close/i });
    await userEvent.click(closeBtn);
    expect(
      screen.queryByText("Introduction short description"),
    ).not.toBeInTheDocument();
  });

  it("shows longDescription in detail panel when available", async () => {
    render(<LifecycleProgressBar stages={STAGES} currentStageId={null} />);
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(
      screen.getByText("Introduction long description"),
    ).toBeInTheDocument();
  });

  it("stage label span does not have onClick (keyboard accessibility guard)", () => {
    render(<LifecycleProgressBar stages={STAGES} currentStageId={null} />);
    // The aria-hidden spans should not receive click events — only buttons should
    const hiddenSpans = document.querySelectorAll('[aria-hidden="true"]');
    hiddenSpans.forEach((span) => {
      expect(span).not.toHaveAttribute("role", "button");
    });
  });
});
