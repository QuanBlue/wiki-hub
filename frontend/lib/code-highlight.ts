import { common, createLowlight } from "lowlight";
import apache from "highlight.js/lib/languages/apache";
import dart from "highlight.js/lib/languages/dart";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import haskell from "highlight.js/lib/languages/haskell";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import scala from "highlight.js/lib/languages/scala";

/**
 * One lowlight instance, shared by the code block extension and the
 * attachment text preview, so both colour a snippet exactly the same way.
 * `common` alone covers 37 languages; the rest are common enough here
 * (infra config, mobile, functional) to be worth the extra weight.
 */
export const lowlight = createLowlight(common);
lowlight.register({
  apache,
  dart,
  dockerfile,
  elixir,
  haskell,
  nginx,
  powershell,
  scala,
});

/**
 * Display labels for the language picker, in the order shown there. The
 * lowlight/hljs registry key is always the map key; this only controls what
 * a person reads and where it sorts. Anything registered but left out here
 * still highlights correctly - it is just not offered as a first choice.
 */
export const CODE_LANGUAGES: Record<string, string> = {
  plaintext: "Plain text",
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dart: "Dart",
  diff: "Diff",
  dockerfile: "Dockerfile",
  elixir: "Elixir",
  go: "Go",
  graphql: "GraphQL",
  haskell: "Haskell",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  less: "Less",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  nginx: "Nginx",
  objectivec: "Objective-C",
  perl: "Perl",
  php: "PHP",
  powershell: "PowerShell",
  python: "Python",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scala: "Scala",
  scss: "SCSS",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  vbnet: "VB.NET",
  xml: "XML / HTML",
  yaml: "YAML",
};

/** True for any language lowlight can actually tokenise. */
export function isKnownCodeLanguage(language: string | null | undefined) {
  return Boolean(language && lowlight.registered(language));
}

/**
 * File-extension fallback for the attachment preview, which has a filename
 * but never an explicit language choice the way a page's code block does.
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  dockerfile: "dockerfile",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  graphql: "graphql",
  hs: "haskell",
  html: "xml",
  htm: "xml",
  ini: "ini",
  conf: "ini",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  kt: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  markdown: "markdown",
  m: "objectivec",
  pl: "perl",
  php: "php",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  vb: "vbnet",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
};

/** Guesses a lowlight language from a filename's extension, or null. */
export function codeLanguageForFilename(filename: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  if (!match) return null;
  const language = EXTENSION_LANGUAGES[match[1].toLowerCase()];
  return language && isKnownCodeLanguage(language) ? language : null;
}

export type CodeToken = { text: string; className: string | null };

type HastNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      properties?: { className?: string[] };
      children: HastNode[];
    };

/**
 * Flattens lowlight's nested hast tree into a flat token list, the same way
 * the code-block-lowlight extension does internally to build its ProseMirror
 * decorations - so a `<span class="hljs-title function_">` becomes one token
 * with `"hljs-title function_"`, not two nested ones.
 */
function flattenHast(nodes: HastNode[], classes: string[] = []): CodeToken[] {
  return nodes.flatMap((node) => {
    if (node.type === "text") {
      return classes.length
        ? [{ text: node.value, className: classes.join(" ") }]
        : [{ text: node.value, className: null }];
    }
    const nextClasses = [...classes, ...(node.properties?.className ?? [])];
    return flattenHast(node.children, nextClasses);
  });
}

/**
 * Highlights an entire file in one pass - a multi-line string or block
 * comment only tokenises correctly with the surrounding lines in view - then
 * splits the flat token stream back into per-line arrays. A token never
 * itself contains a newline: each is cut at every `\n` it spans, so a caller
 * can lay out one line at a time without re-deriving line boundaries.
 *
 * CRLF is normalised to LF up front. Leaving a `\r` in place would attach it
 * to whichever token ends the line, so every line's reconstructed text would
 * carry a trailing `\r` a caller splitting the same file on `/\r?\n/` (as the
 * attachment preview does, to line up with its own search-match offsets)
 * does not expect.
 */
export function highlightToLines(
  rawCode: string,
  language: string | null,
): CodeToken[][] {
  const code = rawCode.replace(/\r\n/g, "\n");
  const lineCount = code.split("\n").length;
  if (!isKnownCodeLanguage(language) || language === "plaintext") {
    return code.split("\n").map((text) => [{ text, className: null }]);
  }

  const tokens = flattenHast(
    lowlight.highlight(language!, code).children as HastNode[],
  );
  const lines: CodeToken[][] = Array.from({ length: lineCount }, () => []);
  let lineIdx = 0;

  for (const token of tokens) {
    let rest = token.text;
    while (rest.includes("\n")) {
      const breakAt = rest.indexOf("\n");
      const before = rest.slice(0, breakAt);
      if (before)
        lines[lineIdx].push({ text: before, className: token.className });
      lineIdx += 1;
      rest = rest.slice(breakAt + 1);
    }
    if (rest) lines[lineIdx].push({ text: rest, className: token.className });
  }

  return lines;
}
