import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AiClarifyQuestions } from "@/components/pages/ai-clarify-questions";

const QUESTIONS = [
  {
    header: "Parts",
    question: "Which parts?",
    multi_select: true,
    options: [
      { label: "Setup", description: "Install it", detail: "Install it, step by step" },
      { label: "Alerts", description: "Same", detail: "Same" },
    ],
  },
];

function setup(busy = false) {
  const onSubmit = vi.fn();
  const onSkip = vi.fn();
  render(
    <AiClarifyQuestions
      questions={QUESTIONS as never}
      busy={busy}
      onSubmit={onSubmit}
      onSkip={onSkip}
    />,
  );
  return { onSubmit, onSkip };
}

describe("AiClarifyQuestions", () => {
  it("lets a choice be taken back, and sends what is still picked", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole("checkbox", { name: /Setup/ }));
    await user.click(screen.getByRole("checkbox", { name: /Alerts/ }));
    await user.click(screen.getByRole("checkbox", { name: /Setup/ }));
    await user.click(screen.getByRole("button", { name: "Write the page" }));

    expect(onSubmit).toHaveBeenCalledWith([{ question: "Which parts?", answer: "Alerts" }]);
  });

  it("offers more detail only where it says more than the description", () => {
    setup();

    expect(screen.getAllByRole("button", { name: "More info" })).toHaveLength(1);
  });

  it("shows it is writing, and cannot be sent twice", () => {
    setup(true);

    expect(screen.getByRole("button", { name: "Writing..." })).toBeDisabled();
  });

  it("skips the questions", async () => {
    const user = userEvent.setup();
    const { onSkip } = setup();

    await user.click(screen.getByRole("button", { name: "Skip questions" }));

    expect(onSkip).toHaveBeenCalled();
  });

  it("navigates Next and Back in multi-question batch mode and submits on Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AiClarifyQuestions
        questions={[
          {
            header: "One",
            question: "First?",
            multi_select: false,
            options: [
              { label: "A", description: "" },
              { label: "B", description: "" },
            ],
          },
          {
            header: "Two",
            question: "Second?",
            multi_select: false,
            options: [
              { label: "C", description: "" },
              { label: "D", description: "" },
            ],
          },
        ]}
        busy={false}
        onSubmit={onSubmit}
        onSkip={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "A" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Second?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("First?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(
      screen.getByLabelText("Or write your own answer"),
      "Custom{Enter}",
    );
    expect(onSubmit).toHaveBeenCalledWith([
      { question: "First?", answer: "A" },
      { question: "Second?", answer: "Custom" },
    ]);
  });

  it("renders recommended badge, rationale, and supports adaptive grill-me controls", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    const onBack = vi.fn();
    const onWriteNow = vi.fn();

    render(
      <AiClarifyQuestions
        adaptive
        questionNumber={2}
        maxQuestions={10}
        canGoBack
        questions={[
          {
            header: "Branches",
            question: "Cover both manual ISO and .tib image?",
            rationale: "Determines whether both paths get step-by-step instructions.",
            multi_select: false,
            options: [
              {
                label: "Both branches",
                description: "Full steps for each",
                recommended: true,
              },
              {
                label: ".tib only",
                description: "Skip manual ISO",
              },
            ],
          },
        ]}
        busy={false}
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
        onAnswer={onAnswer}
        onBack={onBack}
        onWriteNow={onWriteNow}
      />,
    );

    expect(screen.getByText("Question 2 (up to 10)")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Determines whether both paths get step-by-step instructions.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enough, write now" }));
    expect(onWriteNow).toHaveBeenCalledWith(undefined);

    await user.click(screen.getByRole("radio", { name: /Both branches/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onAnswer).toHaveBeenCalledWith({
      header: "Branches",
      question: "Cover both manual ISO and .tib image?",
      answer: "Both branches",
    });

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("disables controls while analyzing the next question in adaptive mode", () => {
    render(
      <AiClarifyQuestions
        adaptive
        thinking
        canGoBack
        questions={QUESTIONS as never}
        busy={false}
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
        onAnswer={vi.fn()}
        onBack={vi.fn()}
        onWriteNow={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Analyzing answer..." }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Enough, write now" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });
});
