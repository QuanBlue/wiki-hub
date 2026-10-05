/**
 * The labels an issue can carry. The slugs are the ones the API stores; the
 * colour is the label's own identity (a data colour, like GitHub's), shown as
 * a dot and a soft tint, so it is not a theme token. Words come from the
 * dictionary: `issueLabels.<key>` and `issueLabels.<key>Description`.
 */
export interface IssueLabelMeta {
  slug: string;
  key: string;
  color: string;
}

export const ISSUE_LABELS: IssueLabelMeta[] = [
  { slug: "bug", key: "bug", color: "#d73a4a" },
  { slug: "documentation", key: "documentation", color: "#0075ca" },
  { slug: "enhancement", key: "enhancement", color: "#2fb5b8" },
  { slug: "good-first-issue", key: "goodFirstIssue", color: "#7057ff" },
  { slug: "help-wanted", key: "helpWanted", color: "#008672" },
  { slug: "question", key: "question", color: "#d876e3" },
];

/** The filter value for "issues without any label" (matches the API). */
export const NO_LABEL = "none";

export function labelMeta(slug: string): IssueLabelMeta | undefined {
  return ISSUE_LABELS.find((label) => label.slug === slug);
}
