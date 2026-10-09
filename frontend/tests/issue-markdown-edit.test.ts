import { describe, expect, it } from "vitest";

import { applyMarkdownFormat } from "@/lib/issue-markdown-edit";

/** Applies a format to the `[` ... `]` marked selection of `text`. */
function apply(format: Parameters<typeof applyMarkdownFormat>[0], text: string) {
  const start = text.indexOf("[");
  const end = text.indexOf("]") - 1;
  const value = text.replace("[", "").replace("]", "");
  const result = applyMarkdownFormat(format, value, start, end);
  return {
    value: result.value,
    selected: result.value.slice(result.selectionStart, result.selectionEnd),
  };
}

describe("applyMarkdownFormat", () => {
  it("wraps the selection in bold, and unwraps it on a second press", () => {
    const once = apply("bold", "say [hello] now");
    expect(once).toEqual({ value: "say **hello** now", selected: "hello" });

    const twice = applyMarkdownFormat("bold", "say **hello** now", 4, 13);
    expect(twice.value).toBe("say hello now");
    expect(twice.value.slice(twice.selectionStart, twice.selectionEnd)).toBe("hello");
  });

  it("accepts a selection made backwards", () => {
    const result = applyMarkdownFormat("italic", "a word", 6, 2);
    expect(result.value).toBe("a _word_");
  });

  it("uses inline code for one line and a fence for several", () => {
    expect(apply("code", "run [npm test] now").value).toBe("run `npm test` now");
    expect(apply("code", "[a\nb]").value).toBe("```\na\nb\n```");
  });

  it("makes a link from the selection, or a placeholder, and selects the URL", () => {
    expect(apply("link", "see [docs]")).toEqual({
      value: "see [docs](https://)",
      selected: "https://",
    });
    expect(apply("link", "see []")).toEqual({
      value: "see [text](https://)",
      selected: "https://",
    });
  });

  it("prefixes every selected line, and removes the prefix when all have it", () => {
    expect(apply("quote", "one\nt[wo\nthr]ee").value).toBe("one\n> two\n> three");
    expect(apply("quote", "[> two\n> three]").value).toBe("two\nthree");
    expect(apply("heading", "[Title]").value).toBe("### Title");
  });

  it("numbers lines in order and swaps one list style for another", () => {
    expect(apply("numbers", "[a\nb\nc]").value).toBe("1. a\n2. b\n3. c");
    expect(apply("bullets", "[1. a\n2. b]").value).toBe("- a\n- b");
    expect(apply("tasks", "[- a\n- b]").value).toBe("- [ ] a\n- [ ] b");
    // A task line is not a plain bullet, so bullets replace the checkbox.
    expect(applyMarkdownFormat("bullets", "- [ ] a", 0, 7).value).toBe("- a");
    expect(applyMarkdownFormat("tasks", "- [x] done", 0, 10).value).toBe("done");
  });
});
