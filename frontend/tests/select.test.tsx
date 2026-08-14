import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function SelectHarness() {
  const [value, setValue] = useState("view");

  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Page permission">
        <SelectValue>{value === "view" ? "Can view" : "Can edit"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="view">Can view</SelectItem>
        <SelectItem value="edit">Can edit</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select", () => {
  it("keeps the selected value after choosing an option", async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);

    const trigger = screen.getByRole("button", { name: "Page permission" });
    expect(trigger).toHaveTextContent("Can view");

    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: "Can edit" }));

    expect(screen.getByRole("button", { name: "Page permission" })).toHaveTextContent("Can edit");
  });
});
