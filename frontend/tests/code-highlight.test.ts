import { describe, expect, it } from "vitest";

import {
  codeLanguageForFilename,
  highlightToLines,
  isKnownCodeLanguage,
} from "@/lib/code-highlight";

describe("isKnownCodeLanguage", () => {
  it("accepts a registered language and rejects everything else", () => {
    expect(isKnownCodeLanguage("python")).toBe(true);
    expect(isKnownCodeLanguage("plaintext")).toBe(true);
    // Registered via the extra grammars, not lowlight's `common` bundle.
    expect(isKnownCodeLanguage("dockerfile")).toBe(true);
    expect(isKnownCodeLanguage("not-a-real-language")).toBe(false);
    expect(isKnownCodeLanguage(null)).toBe(false);
    expect(isKnownCodeLanguage(undefined)).toBe(false);
  });
});

describe("codeLanguageForFilename", () => {
  it("maps common extensions to their language", () => {
    expect(codeLanguageForFilename("deploy.sh")).toBe("bash");
    expect(codeLanguageForFilename("app.py")).toBe("python");
    expect(codeLanguageForFilename("Component.tsx")).toBe("typescript");
    expect(codeLanguageForFilename("values.YAML")).toBe("yaml");
  });

  it("returns null for an unknown or missing extension", () => {
    expect(codeLanguageForFilename("README")).toBeNull();
    expect(codeLanguageForFilename("archive.tar.gz")).toBeNull();
  });
});

describe("highlightToLines", () => {
  it("tokenises every line and reconstructs the original text exactly", () => {
    const code = "def f(x):\n    return x + 1\n";
    const lines = highlightToLines(code, "python");

    expect(lines).toHaveLength(3); // trailing "\n" makes a final empty line
    for (const [idx, expected] of code.split("\n").entries()) {
      expect(lines[idx].map((t) => t.text).join("")).toBe(expected);
    }
    // A keyword is coloured, not left as one flat run of plain text.
    expect(lines[0].some((t) => t.className === "hljs-keyword")).toBe(true);
  });

  it("keeps a compound scope's classes together as one string", () => {
    const lines = highlightToLines("class Foo:\n    pass\n", "python");
    const title = lines[0].find((t) => t.text === "Foo");
    expect(title?.className).toBe("hljs-title class_");
  });

  it("carries one token class across a value that spans multiple lines", () => {
    const code = 'x = """first\nsecond"""\n';
    const lines = highlightToLines(code, "python");
    const firstLineString = lines[0].find((t) => t.text.includes("first"));
    const secondLineString = lines[1].find((t) => t.text.includes("second"));
    expect(firstLineString?.className).toBe("hljs-string");
    expect(secondLineString?.className).toBe("hljs-string");
  });

  it("returns one plain token per line for plaintext or an unknown language", () => {
    const code = "one\ntwo\n";
    for (const language of [null, "plaintext", "not-a-real-language"]) {
      const lines = highlightToLines(code, language);
      expect(lines).toEqual([
        [{ text: "one", className: null }],
        [{ text: "two", className: null }],
        [{ text: "", className: null }],
      ]);
    }
  });

  it("normalises CRLF so no line's tokens carry a trailing \\r", () => {
    // A caller splitting the same file on /\r?\n/ (the attachment preview
    // does, to index search matches) must see the exact same line count and
    // text - a token still ending in "\r" here would break that alignment.
    const code = "x = 1\r\ny = 2\r\n";
    const lines = highlightToLines(code, "python");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      for (const token of line) expect(token.text).not.toContain("\r");
    }
    expect(lines[0].map((t) => t.text).join("")).toBe("x = 1");
    expect(lines[1].map((t) => t.text).join("")).toBe("y = 2");
  });
});
