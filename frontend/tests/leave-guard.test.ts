import { afterEach, describe, expect, it } from "vitest";

import { navigationTargetOf } from "@/components/pages/space-workspace";

/** Builds a click on an anchor the way the document capture listener sees it. */
function clickOn(attributes: Record<string, string>, childTag?: string) {
  const link = document.createElement("a");
  for (const [name, value] of Object.entries(attributes))
    link.setAttribute(name, value);
  const clicked: HTMLElement = childTag
    ? link.appendChild(document.createElement(childTag))
    : link;
  document.body.append(link);

  const event = new MouseEvent("click", { bubbles: true, button: 0 });
  Object.defineProperty(event, "target", { value: clicked });
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("navigationTargetOf", () => {
  const attachment =
    "/api/v1/attachments/11111111-1111-1111-1111-111111111111/content";

  it("reports the destination of an ordinary internal link", () => {
    const target = navigationTargetOf(
      clickOn({ href: "/spaces/DEV/pages/other" }),
    );
    expect(target?.pathname).toBe("/spaces/DEV/pages/other");
  });

  it("ignores an attachment link, which opens a preview instead of leaving", () => {
    // Regression: the guard used to challenge these, so clicking an attachment
    // raised "Save changes before leaving?" rather than the preview modal.
    expect(
      navigationTargetOf(clickOn({ href: attachment, target: "_self" })),
    ).toBeNull();
  });

  it("ignores a click on the icon inside an attachment tile", () => {
    expect(
      navigationTargetOf(clickOn({ href: attachment }, "span")),
    ).toBeNull();
  });

  it("still ignores downloads, new tabs and modified clicks", () => {
    expect(
      navigationTargetOf(clickOn({ href: "/file.zip", download: "" })),
    ).toBeNull();
    expect(
      navigationTargetOf(clickOn({ href: "/elsewhere", target: "_blank" })),
    ).toBeNull();
  });
});
