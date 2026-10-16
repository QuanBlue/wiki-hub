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
});
