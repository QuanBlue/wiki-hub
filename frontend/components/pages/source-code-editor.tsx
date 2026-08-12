"use client";

import { html } from "@codemirror/lang-html";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { CodeXml } from "lucide-react";
import { useEffect, useRef } from "react";

type SourceLanguage = "html" | "markdown";

const wikiHubEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--surface)",
    color: "var(--foreground)",
    fontSize: "0.875rem",
    minHeight: "calc(100vh - 21rem)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.5rem",
    overflow: "auto",
  },
  ".cm-content": { caretColor: "var(--foreground)", padding: "1rem 0" },
  ".cm-line": { padding: "0 1rem" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-sunken)",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLine": { backgroundColor: "var(--surface-hover)" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--surface-hover)",
    color: "var(--primary)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "2.25rem",
    padding: "0 0.5rem 0 0.75rem",
  },
  ".cm-foldGutter": { width: "1.25rem" },
  ".cm-foldGutter .cm-gutterElement": {
    borderRadius: "0.25rem",
    cursor: "pointer",
    display: "flex",
    height: "1.5rem",
    justifyContent: "center",
    padding: "0",
    width: "1.25rem",
  },
  ".cm-foldGutter .cm-gutterElement:hover": { backgroundColor: "var(--surface-selected)" },
  ".cm-foldGutter span[title]": {
    display: "block",
    fontSize: "0",
    height: "0.625rem",
    position: "relative",
    width: "0.625rem",
  },
  ".cm-foldGutter span[title]::before": {
    borderBottom: "1.5px solid currentColor",
    borderRight: "1.5px solid currentColor",
    content: '\"\"',
    height: "0.4rem",
    left: "0.08rem",
    position: "absolute",
    top: "0.04rem",
    transform: "rotate(45deg)",
    transition: "transform 150ms",
    width: "0.4rem",
  },
  ".cm-foldGutter span[title='Unfold line']::before": {
    left: "0",
    top: "0.12rem",
    transform: "rotate(-45deg)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--primary-subtle)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
});

const wikiHubHighlightStyle = HighlightStyle.define([
  { tag: [tags.tagName, tags.heading], color: "var(--primary)", fontWeight: "600" },
  { tag: tags.attributeName, color: "var(--muted-foreground)" },
  { tag: [tags.string, tags.url], color: "var(--danger)" },
  { tag: [tags.comment, tags.meta], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.bracket], color: "var(--muted-foreground)" },
  { tag: [tags.keyword, tags.strong], color: "var(--primary)", fontWeight: "600" },
]);

export function SourceCodeEditor({
  language,
  value,
  onChange,
}: {
  language: SourceLanguage;
  value: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!host.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          basicSetup,
          language === "html" ? html() : markdown(),
          wikiHubEditorTheme,
          syntaxHighlighting(wikiHubHighlightStyle),
          EditorView.contentAttributes.of({
            "aria-label": language === "html" ? "HTML source" : "Markdown source",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: host.current,
    });
    editor.current = view;

    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [language]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div className="border-border bg-surface focus-within:ring-ring overflow-hidden rounded-md border shadow-sm transition-[border-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-background">
      <div className="border-border bg-surface-sunken flex items-center gap-2 border-b px-4 py-2.5">
        <CodeXml className="text-primary size-4" aria-hidden />
        <p className="text-xs font-semibold tracking-wide uppercase">
          {language} source
        </p>
        <span className="text-muted-foreground ml-auto text-xs">Editable source</span>
      </div>
      <div ref={host} className="min-h-[calc(100vh-21rem)]" />
    </div>
  );
}
