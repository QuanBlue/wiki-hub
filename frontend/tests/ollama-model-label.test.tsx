import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OllamaModelLabel } from "@/components/admin/ollama-model-label";

describe("OllamaModelLabel", () => {
  it("says whether a model is on the server and offers a description of the ones it knows", () => {
    render(<OllamaModelLabel name="bge-m3:latest" downloaded />);

    expect(screen.getByText("bge-m3:latest")).toBeInTheDocument();
    expect(screen.getByText("downloaded")).toBeInTheDocument();
    expect(screen.getByLabelText("More info")).toBeInTheDocument();
  });

  it("has nothing to describe for a model it does not know, and says it is not downloaded", () => {
    render(<OllamaModelLabel name="some-new-model" downloaded={false} />);

    expect(screen.getByText("some-new-model")).toBeInTheDocument();
    expect(screen.getByText("not downloaded")).toBeInTheDocument();
    expect(screen.queryByLabelText("More info")).toBeNull();
  });
});
