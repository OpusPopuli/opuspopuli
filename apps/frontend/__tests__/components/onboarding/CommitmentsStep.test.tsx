/**
 * CommitmentsStep (#754) — onboarding ack flow.
 *
 * Covers the contract the issue's AC pins down: the continue button is
 * disabled until the checkbox is checked, the mutation is called with
 * the current published `COMMITMENTS_VERSION`, and `onComplete` only
 * fires after a successful mutation.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { CommitmentsStep } from "@/components/onboarding/steps/CommitmentsStep";
import { COMMITMENTS_VERSION } from "@/lib/commitments";

const mockAck = jest.fn();
let mockMutationState = { loading: false };

jest.mock("@apollo/client/react", () => ({
  useMutation: () => [mockAck, mockMutationState],
}));

describe("CommitmentsStep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMutationState = { loading: false };
    mockAck.mockResolvedValue({
      data: {
        acknowledgeCommitments: {
          id: "u-1",
          commitmentsAcknowledgedAt: "2026-06-13T17:00:00.000Z",
          commitmentsVersionAcknowledged: COMMITMENTS_VERSION,
        },
      },
    });
  });

  it("renders the ack heading and a continue button that starts disabled", () => {
    render(<CommitmentsStep onComplete={jest.fn()} />);

    expect(
      screen.getByRole("heading", { name: /acknowledge these commitments/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeDisabled();
  });

  it("enables the continue button after the checkbox is checked", async () => {
    render(<CommitmentsStep onComplete={jest.fn()} />);
    const checkbox = screen.getByRole("checkbox");

    await userEvent.click(checkbox);

    expect(screen.getByRole("button", { name: /get started/i })).toBeEnabled();
  });

  it("does NOT call the mutation when continue is clicked without checking", async () => {
    render(<CommitmentsStep onComplete={jest.fn()} />);

    // The button is disabled but try-click anyway — defensive: even if
    // a future restyle re-enables it, the submit handler should bail.
    const button = screen.getByRole("button", { name: /get started/i });
    await userEvent.click(button);

    expect(mockAck).not.toHaveBeenCalled();
  });

  it("calls acknowledgeCommitments with the current version and then onComplete", async () => {
    const onComplete = jest.fn();
    render(<CommitmentsStep onComplete={onComplete} />);

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /get started/i }));

    expect(mockAck).toHaveBeenCalledWith({
      variables: { version: COMMITMENTS_VERSION },
    });
    expect(onComplete).toHaveBeenCalled();
  });

  it("does not call onComplete and surfaces an error when the mutation fails", async () => {
    mockAck.mockRejectedValueOnce(new Error("network down"));
    const onComplete = jest.fn();
    render(<CommitmentsStep onComplete={onComplete} />);

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /get started/i }));

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/network down/i);
  });

  it("renders all ten commitments in the inline summary list", () => {
    render(<CommitmentsStep onComplete={jest.fn()} />);

    const list = screen.getByRole("list");
    expect(list.querySelectorAll("li")).toHaveLength(10);
  });
});
