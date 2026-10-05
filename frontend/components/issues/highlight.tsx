import type { ReactNode } from "react";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Text with every occurrence of any search word marked in the primary colour,
 * case-insensitively. Words are matched literally (a "." is a dot, not a
 * wildcard), and nothing is injected as HTML.
 */
export function Highlight({
  text,
  words,
}: {
  text: string;
  words: string[];
}): ReactNode {
  const needles = words.filter(Boolean);
  if (needles.length === 0) return text;
  const pattern = new RegExp(
    `(${needles
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})`,
    "gi",
  );
  const lowered = needles.map((word) => word.toLowerCase());
  return text.split(pattern).map((part, index) =>
    lowered.includes(part.toLowerCase()) ? (
      <mark
        key={index}
        className="bg-primary/25 text-primary rounded-xs px-0.5 font-bold"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
