import { describe, expect, it } from "vitest";

import { foldText, highlightRanges } from "@/lib/search-highlight";

function marked(text: string, terms: string[]): string[] {
  return highlightRanges(text, terms).map(([start, end]) =>
    text.slice(start, end),
  );
}

describe("foldText", () => {
  it("keeps the length while dropping accents, case and separators", () => {
    const text = "Đặng Văn_Hùng-Tessel.vn";
    const folded = foldText(text);
    expect(folded).toBe("dang van hung tessel vn");
    expect(folded.length).toBe(text.length);
  });
});

describe("highlightRanges", () => {
  it("marks whole words that start with a term, ignoring accents and capitals", () => {
    expect(marked("Tài khoản của NUTIFOOD_VTS", ["tai khoan", "nuti"])).toEqual(
      ["Tài khoản", "NUTIFOOD"],
    );
  });

  it("marks synonyms the server sent along", () => {
    expect(
      marked("Account ViettelCloud", ["tai khoan", "account", "cloud"]),
    ).toEqual(["Account"]);
  });

  it("only matches at the start of a word", () => {
    expect(marked("viettelcloud và cloud", ["cloud"])).toEqual(["cloud"]);
  });

  it("prefers the longer term when two start the same way", () => {
    expect(marked("Tessel_v2 abbott", ["tessel", "tessel v2"])).toEqual([
      "Tessel_v2",
    ]);
  });

  it("treats regex characters literally and copes with nothing to mark", () => {
    expect(marked("a (b) c", ["(b)"])).toEqual(["(b)"]);
    expect(highlightRanges("anything", [])).toEqual([]);
    expect(highlightRanges("", ["x"])).toEqual([]);
  });
});

describe("highlighting IP addresses", () => {
  it("marks every IPv4 address when the query asked about IP, and leaves version numbers alone", () => {
    const text =
      "DMS: 10.10.10.64 and http://117.1.29.44:8801 (v1.2.3 build 4.5.6.7.8)";
    const marked = highlightRanges(text, ["ipaddr"]).map(([a, b]) =>
      text.slice(a, b),
    );

    expect(marked).toEqual(["10.10.10.64", "117.1.29.44"]);
  });

  it("combines addresses with the other words, in reading order", () => {
    const text = "Server dms at 10.0.0.1";
    const marked = highlightRanges(text, ["dms", "ipaddr"]).map(([a, b]) =>
      text.slice(a, b),
    );

    expect(marked).toEqual(["dms", "10.0.0.1"]);
  });
});
