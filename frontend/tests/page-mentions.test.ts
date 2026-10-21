import { describe, expect, it } from "vitest";

import { fold, linkMentions } from "@/lib/page-mentions";

const form = { title: "Mẫu đơn nghỉ phép", slug: "mau-don", space_key: "HR" };

describe("fold", () => {
  it("folds like the backend: no accents, lower case, đ to d, breaks to spaces", () => {
    expect(fold("Đơn_vị Hỗ-TRỢ")).toBe("don vi ho tro");
    expect(fold("Đơn_vị Hỗ-TRỢ")).toHaveLength("Đơn_vị Hỗ-TRỢ".length);
  });
});

describe("linkMentions", () => {
  it("links the first mention, keeping the words as written", () => {
    const html = linkMentions(
      "<p>Điền MẪU ĐƠN nghỉ phép rồi gửi. Lại mẫu đơn nghỉ phép.</p>",
      [form],
    );
    expect(html).toBe(
      '<p>Điền <a href="/spaces/HR/pages/mau-don">MẪU ĐƠN nghỉ phép</a> rồi gửi. Lại mẫu đơn nghỉ phép.</p>',
    );
  });

  it("matches whole words only", () => {
    const html = "<p>prometheusexporter</p>";
    expect(
      linkMentions(html, [{ title: "Prometheus", slug: "p", space_key: "A" }]),
    ).toBe(html);
  });

  it("leaves links, code and headings alone", () => {
    const html =
      '<h2>Mẫu đơn nghỉ phép</h2><p><a href="/x">mẫu đơn nghỉ phép</a> <code>mẫu đơn nghỉ phép</code></p>';
    expect(linkMentions(html, [form])).toBe(html);
  });

  it("lets the longer title win", () => {
    const html = linkMentions("<p>Send the leave request form.</p>", [
      { title: "Leave request", slug: "short", space_key: "A" },
      { title: "Leave request form", slug: "long", space_key: "A" },
    ]);
    expect(html).toContain('<a href="/spaces/A/pages/long">leave request form</a>');
    expect(html).not.toContain("/pages/short");
  });

  it("keeps positions right after characters outside the basic plane", () => {
    const html = linkMentions("<p>😀 see Prometheus now</p>", [
      { title: "Prometheus", slug: "p", space_key: "A" },
    ]);
    expect(html).toBe('<p>😀 see <a href="/spaces/A/pages/p">Prometheus</a> now</p>');
  });

  it("returns the html untouched without mentions", () => {
    expect(linkMentions("<p>x</p>", [])).toBe("<p>x</p>");
  });
});
