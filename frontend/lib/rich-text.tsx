import { Fragment, type ReactNode } from "react";

// **bold**, `code`, then *italic* - in that order, so `**` is never read as
// two stray `*italic*` markers first. Deliberately not nested (a toast is one
// short sentence, not a document) and not greedy across markers of a
// different kind.
const PATTERN = /\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*/g;

/**
 * Turns the light emphasis markers above into `<strong>`/`<code>`/`<em>`, so a
 * name, value or identifier worth reading first can stand out in a toast (see
 * the "Emphasis" rules in globals.css) instead of being set off with
 * "smart quotes". Plain text with no markers passes through unchanged.
 */
export function richText(text: string): ReactNode {
  if (!text.includes("*") && !text.includes("`")) return text;

  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const [, bold, code, italic] = match;
    if (bold !== undefined) nodes.push(<strong key={key++}>{bold}</strong>);
    else if (code !== undefined) nodes.push(<code key={key++}>{code}</code>);
    else nodes.push(<em key={key++}>{italic}</em>);
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <Fragment>{nodes}</Fragment>;
}
