import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { TopicsStep } from "@/components/onboarding/steps/TopicsStep";
import en from "@/locales/en/onboarding.json";

const updateSignal = jest.fn().mockResolvedValue({ data: {} });
let signalProfile: unknown = null;

jest.mock("@apollo/client/react", () => ({
  useQuery: () => ({ data: { mySignalProfile: signalProfile } }),
  useMutation: () => [updateSignal, { loading: false }],
}));

beforeEach(() => {
  jest.clearAllMocks();
  signalProfile = null;
});

const renderStep = (onComplete = jest.fn()) => {
  render(<TopicsStep onComplete={onComplete} isLastStep={false} />);
  return onComplete;
};

const inputOf = () => updateSignal.mock.calls[0][0].variables.input;

describe("TopicsStep", () => {
  it("writes topics and life context in a single mutation", async () => {
    // Two calls would leave the profile describing a person who never existed
    // if the second failed. They land in the same signal profile, so they go
    // in one write.
    const user = userEvent.setup();
    const onComplete = renderStep();

    await user.click(screen.getByText(en.topics.options.housing));
    await user.click(screen.getByText(en.lifeContext.summary));
    await user.click(screen.getByText(en.lifeContext.chips.housing.renter));
    await user.click(screen.getByRole("button", { name: en.saveAndContinue }));

    expect(updateSignal).toHaveBeenCalledTimes(1);
    expect(inputOf()).toEqual({
      interestTags: ["housing"],
      housingTenure: "renter",
    });
    expect(onComplete).toHaveBeenCalled();
  });

  it("writes topics alone when the optional section is untouched", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByText(en.topics.options.healthcare));
    await user.click(screen.getByRole("button", { name: en.saveAndContinue }));

    expect(inputOf()).toEqual({ interestTags: ["healthcare"] });
  });

  it("writes life context alone when no topic is picked", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByText(en.lifeContext.summary));
    await user.click(screen.getByText(en.lifeContext.chips.family.parent));
    await user.click(screen.getByRole("button", { name: en.saveAndContinue }));

    expect(inputOf()).toEqual({ parentOfStudent: ["public"] });
  });

  it("writes nothing when neither half was touched", async () => {
    const user = userEvent.setup();
    const onComplete = renderStep();

    await user.click(screen.getByRole("button", { name: en.saveAndContinue }));

    expect(updateSignal).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it("does not rewrite an unchanged profile on a click-through", async () => {
    // The onboarding "I'm a student" chip collapses K12/college/grad, so a
    // no-edit re-submit would silently flip a returning K12 student to
    // 'college'.
    signalProfile = {
      interestTags: ["housing", "taxes"],
      studentLevel: "K12",
      housingTenure: "renter",
    };
    const user = userEvent.setup();
    const onComplete = renderStep();

    await user.click(screen.getByRole("button", { name: en.saveAndContinue }));

    expect(updateSignal).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it("keeps the optional section collapsed until asked for", async () => {
    renderStep();
    expect(
      screen.queryByText(en.lifeContext.chips.housing.renter),
    ).not.toBeVisible();
  });

  it("clears both halves on skip", async () => {
    const user = userEvent.setup();
    const onComplete = renderStep();

    await user.click(screen.getByText(en.topics.options.housing));
    await user.click(screen.getByRole("button", { name: en.skipStep }));

    expect(updateSignal).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });
});
