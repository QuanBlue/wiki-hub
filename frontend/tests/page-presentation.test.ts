import { describe, expect, it } from "vitest";
import {
  FRONTEND_SLIDE_THEMES,
  generateStandaloneFrontendSlidesHtml,
  getSlideThemeById,
} from "@/lib/frontend-slides-themes";
import {
  buildSlidesFromAiDeck,
  buildSlidesFromPage,
  canPresentPath,
} from "@/lib/page-presentation";

describe("canPresentPath", () => {
  it("recognizes space, page, and public share routes", () => {
    expect(canPresentPath("/spaces/ENG")).toBe(true);
    expect(canPresentPath("/spaces/ENG/pages/architecture")).toBe(true);
    expect(canPresentPath("/share/abc123token")).toBe(true);
    expect(canPresentPath("/admin/users")).toBe(false);
    expect(canPresentPath("/")).toBe(false);
    expect(canPresentPath(null)).toBe(false);
  });
});

describe("buildSlidesFromPage", () => {
  it("creates a cover slide with lead paragraph subtitle and splits by H1/H2 in standard mode", () => {
    const html = `
      <p>Executive summary of our distributed backend architecture.</p>
      <h2>1. Core Services</h2>
      <ul>
        <li>FastAPI gateway</li>
        <li>PostgreSQL 16 storage</li>
      </ul>
      <h3>1.1 Sub-detail kept inside H2 in standard mode</h3>
      <p>Details about connection pooling.</p>
      <h2>2. Deployment</h2>
      <p>Docker Compose stack.</p>
    `;

    const slides = buildSlidesFromPage({
      title: "Backend Architecture",
      content: html,
      contentFormat: "html",
      spaceName: "Engineering",
      spaceKey: "ENG",
      author: "quannt",
      updatedAtFormatted: "Nov 26, 2026",
      labels: ["architecture", "backend"],
      granularity: "standard",
    });

    expect(slides.length).toBe(3);
    expect(slides[0]?.layout).toBe("cover");
    expect(slides[0]?.title).toBe("Backend Architecture");
    expect(slides[0]?.subtitle).toBe(
      "Executive summary of our distributed backend architecture.",
    );
    expect(slides[0]?.bullets).toEqual(["architecture", "backend"]);

    expect(slides[1]?.title).toBe("1. Core Services");
    expect(slides[1]?.bodyHtml).toContain("1.1 Sub-detail");
    expect(slides[2]?.title).toBe("2. Deployment");
  });

  it("splits H3 into separate slides in detailed mode and only on HR in divider mode", () => {
    const html = `
      <h2>Section A</h2>
      <p>Intro A</p>
      <h3>Subsection A.1</h3>
      <p>Detail A.1</p>
      <hr />
      <p>After divider</p>
    `;

    const detailed = buildSlidesFromPage({
      title: "Doc",
      content: html,
      spaceName: "Engineering",
      spaceKey: "ENG",
      granularity: "detailed",
    });
    // Cover + Section A + Subsection A.1 + After divider = 4
    expect(detailed.map((s) => s.title)).toEqual([
      "Doc",
      "Section A",
      "Subsection A.1",
      "Doc",
    ]);

    const dividerOnly = buildSlidesFromPage({
      title: "Doc",
      content: html,
      spaceName: "Engineering",
      spaceKey: "ENG",
      granularity: "divider",
    });
    // Cover + before HR + after HR = 3
    expect(dividerOnly.length).toBe(3);
  });

  it("detects 2-column split layout when a slide combines text and an image or Mermaid diagram, and extracts speaker notes", () => {
    const html = `
      <h2>System Topology</h2>
      <ul>
        <li>Ingress routes traffic to API</li>
        <li>Workers process background jobs</li>
      </ul>
      <div data-diagram-block data-code="flowchart LR\nA --> B"></div>
      <div data-callout data-type="note"><p>Mention the failover SLA to the client.</p></div>
    `;

    const slides = buildSlidesFromPage({
      title: "Topology",
      content: html,
      spaceName: "Ops",
      spaceKey: "OPS",
      granularity: "standard",
    });

    expect(slides.length).toBe(2);
    const topologySlide = slides[1]!;
    expect(topologySlide.layout).toBe("split");
    expect(topologySlide.visuals.length).toBe(1);
    expect(topologySlide.visuals[0]?.kind).toBe("mermaid");
    expect(topologySlide.visuals[0]?.mermaidCode).toContain("flowchart LR");
    expect(topologySlide.speakerNotes).toEqual([
      "Mention the failover SLA to the client.",
    ]);
  });

  it("cleans clashing inline table styles, removes blank spacer rows, and paginates large tables with repeated headers", () => {
    const bodyRows = Array.from({ length: 10 })
      .map(
        (_, i) =>
          `<tr><td style="background-color: #1f4e79; color: white;">Row ${i + 1}</td><td>Detail ${i + 1}</td></tr>`,
      )
      .join("");
    const html = `
      <h2>Change Log</h2>
      <table style="width: 1200px; background: #eee;">
        <colgroup><col width="400" /><col width="800" /></colgroup>
        <thead><tr><th style="background-color: #003366;">Item</th><th>Notes</th></tr></thead>
        <tbody>
          ${bodyRows}
          <tr><td></td><td></td></tr>
          <tr><td>   </td><td></td></tr>
        </tbody>
      </table>
    `;

    const slides = buildSlidesFromPage({
      title: "Spec",
      content: html,
      spaceName: "Engineering",
      spaceKey: "ENG",
      granularity: "standard",
    });

    // Cover + 2 paginated table slides (7 rows + 3 rows, blank rows stripped)
    expect(slides.length).toBe(3);
    const part1Html = slides[1]?.visuals[0]?.html ?? "";
    const part2Html = slides[2]?.visuals[0]?.html ?? "";
    expect(part1Html).toContain("<thead>");
    expect(part1Html).toContain("Row 1");
    expect(part1Html).toContain("Row 7");
    expect(part1Html).not.toContain("Row 8");
    expect(part1Html).not.toContain("#1f4e79");
    expect(part1Html).not.toContain("<colgroup>");
    expect(part2Html).toContain("<thead>");
    expect(part2Html).toContain("Row 8");
    expect(part2Html).toContain("Row 10");
  });

  it("splits tall nested bullet lists across multiple slides so no slide needs a scrollbar", () => {
    const html = `
      <h2>Quan điểm đấu nối</h2>
      <ul>
        <li>Các máy chủ ứng dụng phải nằm trong cùng vùng mạng đảm bảo ATTT.</li>
        <li>
          Về mặt phân lớp vai trò ứng dụng chia thành các vùng mạng riêng biệt
          <ul>
            <li>Vùng máy chủ ứng dụng:<ul><li>Các server k8s</li><li>Redis cache</li><li>Minio storage</li></ul></li>
            <li>Vùng máy chủ CSDL:<ul><li>MariaDB, MongoDB, Doris</li><li>Kafka, Debezium sync</li></ul></li>
            <li>Vùng máy chủ quản lý:<ul><li>k8s master</li><li>Giám sát & CICD</li></ul></li>
            <li>Vùng backup dữ liệu</li>
          </ul>
        </li>
      </ul>
    `;

    const slides = buildSlidesFromPage({
      title: "Network",
      content: html,
      spaceName: "Infra",
      spaceKey: "INF",
      granularity: "standard",
    });

    // Cover + at least 2 slides for the tall nested list
    expect(slides.length).toBeGreaterThanOrEqual(3);
    expect(slides[1]?.partIndex).toBe(1);
    expect(slides[1]?.partTotal).toBeGreaterThanOrEqual(2);
  });
});

describe("buildSlidesFromAiDeck", () => {
  it("converts AI executive deck items into PresentationSlides with cover slide", () => {
    const slides = buildSlidesFromAiDeck(
      [
        {
          title: "Key Objectives",
          subtitle: "Q4 Rollout",
          bullets: ["Zero downtime migration", "**Argon2id** authentication"],
          speaker_notes: "Emphasize security compliance.",
          layout: "bullets",
        },
      ],
      {
        title: "Q4 Plan",
        spaceName: "Product",
        spaceKey: "PROD",
        author: "admin",
        labels: ["q4"],
      },
    );

    expect(slides.length).toBe(2);
    expect(slides[0]?.layout).toBe("cover");
    expect(slides[1]?.title).toBe("Key Objectives");
    expect(slides[1]?.bullets[1]).toContain("<strong>Argon2id</strong>");
    expect(slides[1]?.speakerNotes).toEqual(["Emphasize security compliance."]);
  });
});

describe("frontend-slides themes & standalone HTML generator", () => {
  it("provides all 12 curated style presets and generates a self-contained 1920x1080 HTML deck", () => {
    expect(FRONTEND_SLIDE_THEMES.length).toBe(12);
    const theme = getSlideThemeById("notebook-tabs");
    expect(theme.name).toBe("Notebook Tabs");

    const slides = buildSlidesFromPage({
      title: "Architecture Deck",
      content: "<h2>Overview</h2><p>Fixed 16:9 stage</p>",
      spaceName: "Engineering",
      spaceKey: "ENG",
      granularity: "standard",
    });

    const html = generateStandaloneFrontendSlidesHtml({
      title: "Architecture Deck",
      spaceName: "Engineering",
      slides,
      theme,
      strokesBySlide: {
        [slides[1]!.id]: [
          {
            color: "#38bdf8",
            points: [
              { x: 100, y: 200 },
              { x: 400, y: 350 },
            ],
          },
        ],
      },
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(".deck-stage");
    expect(html).toContain("width: 1920px");
    expect(html).toContain("height: 1080px");
    expect(html).toContain("Architecture Deck");
    expect(html).toContain("slide-draw-overlay");
    expect(html).toContain("#38bdf8");
    expect(html).toContain("M 100.0 200.0 L 400.0 350.0");
  });
});
