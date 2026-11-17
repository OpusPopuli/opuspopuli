import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { axe } from "@/__tests__/utils/a11y-utils";
import { PromptRecordView } from "@/components/ai/PromptRecordView";
import type { PromptRecord } from "@/lib/prompt-record";

const HASH = "d8cec07ff987ef2345f1f1d2948a3763667d0f695956d7f5243e609961d0e36d";

const published: PromptRecord = {
  status: "published",
  hash: HASH,
  labels: [
    { name: "document-analysis-proposition-analysis", version: 4 },
    { name: "document-analysis-proposition-analysis-quoted", version: 1 },
  ],
  text: "Analyse {{FULL_TEXT}} plainly.",
  fileUrl: `https://github.com/OpusPopuli/prompt-service/blob/main/attestation/templates/${HASH}.txt`,
  rawUrl: `https://raw.githubusercontent.com/OpusPopuli/prompt-service/main/attestation/templates/${HASH}.txt`,
};

describe("PromptRecordView", () => {
  it("shows which prompt it is, its exact text, and how to check it", () => {
    render(<PromptRecordView record={published} />);
    expect(screen.getByText(HASH)).toBeInTheDocument();
    expect(
      screen.getByText("document-analysis-proposition-analysis"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("document-analysis-proposition-analysis-quoted"),
    ).toBeInTheDocument();
    // The prompt's own placeholders survive untouched.
    expect(
      screen.getByText("Analyse {{FULL_TEXT}} plainly."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: `templates/${HASH}.txt` }),
    ).toHaveAttribute(
      "href",
      published.status === "published" ? published.rawUrl : "",
    );
    expect(screen.getByText(`shasum -a 256 ${HASH}.txt`)).toBeInTheDocument();
  });

  it("renders the placeholder explanation literally", () => {
    render(<PromptRecordView record={published} />);
    expect(
      screen.getByText(/inserted where markers like \{\{TEXT\}\} appear/),
    ).toBeInTheDocument();
  });

  it("says plainly when a fingerprint is not in the public record", () => {
    render(<PromptRecordView record={{ status: "unpublished", hash: HASH }} />);
    expect(
      screen.getByText(/not in the public prompt record/),
    ).toBeInTheDocument();
  });

  it("never calls an unreadable record 'not published'", () => {
    render(<PromptRecordView record={{ status: "unavailable", hash: HASH }} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "could not read the public prompt record",
    );
    expect(screen.queryByText(/not in the public prompt record/)).toBeNull();
  });

  it("explains what a fingerprint looks like when given something else", () => {
    render(<PromptRecordView record={{ status: "invalid", hash: "abc" }} />);
    expect(
      screen.getByText(/That is not a prompt fingerprint/),
    ).toBeInTheDocument();
  });

  it.each([
    ["published", published],
    ["unpublished", { status: "unpublished", hash: HASH } as PromptRecord],
    ["unavailable", { status: "unavailable", hash: HASH } as PromptRecord],
  ])("has no accessibility violations when %s", async (_name, record) => {
    const { container } = render(<PromptRecordView record={record} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
