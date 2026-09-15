"use client";

import { indentWithTab } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import {
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import {
  CodeXml,
  Undo2,
  UnfoldHorizontal,
  WandSparkles,
  WrapText,
} from "lucide-react";
import * as prettier from "prettier/standalone";
import htmlPlugin from "prettier/plugins/html";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { toast } from "sonner";

type SourceLanguage = "html" | "markdown";

const wikiHubEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--surface)",
    color: "var(--foreground)",
    fontFamily:
      "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Consolas, monospace",
    fontSize: "0.8125rem",
  },
  ".cm-scroller": {
    fontFamily:
      "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Consolas, monospace",
    lineHeight: "1.6rem",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--foreground)",
    fontFamily:
      "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Consolas, monospace",
    padding: "1rem 0",
  },
  ".cm-line": {
    fontFamily:
      "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Consolas, monospace",
    padding: "0 1rem",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-sunken)",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    fontFamily:
      "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Consolas, monospace",
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
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    width: "1.25rem",
  },
  ".cm-foldGutter .cm-gutterElement:hover": {
    backgroundColor: "var(--surface-selected)",
  },
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
    left: "50%",
    position: "absolute",
    top: "50%",
    transform: "translate(-50%, -50%) rotate(45deg)",
    transition: "transform 150ms",
    width: "0.4rem",
  },
  ".cm-foldGutter span[title='Unfold line']::before": {
    transform: "translate(-50%, -50%) rotate(-45deg)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--primary-subtle)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
});

const wikiHubHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.tagName, tags.heading],
    color: "var(--primary)",
    fontWeight: "600",
  },
  { tag: tags.attributeName, color: "var(--muted-foreground)" },
  { tag: [tags.string, tags.url], color: "var(--danger)" },
  {
    tag: [tags.comment, tags.meta],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  { tag: [tags.punctuation, tags.bracket], color: "var(--muted-foreground)" },
  {
    tag: [tags.keyword, tags.strong],
    color: "var(--primary)",
    fontWeight: "600",
  },
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
  const wrapping = useRef(new Compartment());
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [wrapText, setWrapText] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [prettierApplied, setPrettierApplied] = useState(false);
  const beforePrettier = useRef<string | null>(null);
  const { t } = useTranslation();

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
          indentUnit.of("  "),
          indentOnInput(),
          keymap.of([indentWithTab]),
          wrapping.current.of(wrapText ? EditorView.lineWrapping : []),
          wikiHubEditorTheme,
          syntaxHighlighting(wikiHubHighlightStyle),
          EditorView.contentAttributes.of({
            "aria-label":
              language === "html"
                ? t("workspace.htmlSource")
                : t("workspace.markdownSource"),
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              onChangeRef.current(update.state.doc.toString());
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
  }, [language, t]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: wrapping.current.reconfigure(
        wrapText ? EditorView.lineWrapping : [],
      ),
    });
  }, [wrapText]);

  async function formatHtml() {
    if (language !== "html" || !editor.current || prettierApplied) return;
    setFormatting(true);
    try {
      const source = editor.current.state.doc.toString();
      const formatted = await prettier.format(source, {
        parser: "html",
        plugins: [htmlPlugin],
        printWidth: 100,
        tabWidth: 2,
        useTabs: false,
      });
      const view = editor.current;
      if (!view) return;
      beforePrettier.current = source;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: formatted },
      });
      setPrettierApplied(true);
    } catch {
      // Per the product's notification rules, use the toast instead of
      // window.alert for in-app failures.
      toast.error(t("sourceEditor.prettierError"));
    } finally {
      setFormatting(false);
    }
  }

  function unprettierHtml() {
    const view = editor.current;
    const previous = beforePrettier.current;
    if (language !== "html" || !view || previous === null) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: previous },
    });
    beforePrettier.current = null;
    setPrettierApplied(false);
  }

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div className="border-border bg-surface focus-within:ring-ring focus-within:ring-offset-background min-w-0 max-w-full rounded-md border shadow-sm transition-[border-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-offset-2">
      <div className="border-border bg-surface-sunken sticky top-topbar md:top-0 z-20 flex flex-wrap items-center gap-2 rounded-t-md border-b px-4 py-2.5 shadow-xs">
        <CodeXml className="text-primary size-4" aria-hidden />
        <p className="text-xs font-semibold tracking-wide uppercase">
          {language === "html"
            ? t("workspace.htmlSource")
            : t("workspace.markdownSource")}
        </p>
        <span className="text-muted-foreground ml-auto text-xs">
          {t("sourceEditor.editableSource")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={wrapText}
          title={wrapText ? t("sourceEditor.unwrapText") : t("sourceEditor.wrapText")}
          onClick={() => setWrapText((current) => !current)}
          className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          {wrapText ? (
            <UnfoldHorizontal className="size-4" aria-hidden />
          ) : (
            <WrapText className="size-4" aria-hidden />
          )}
          {wrapText ? t("sourceEditor.unwrapText") : t("sourceEditor.wrapText")}
        </Button>
        {language === "html" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={
              prettierApplied
                ? t("sourceEditor.unprettierTitle")
                : t("sourceEditor.prettierTitle")
            }
            onClick={() =>
              prettierApplied ? unprettierHtml() : void formatHtml()
            }
            disabled={formatting}
            className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            {prettierApplied ? (
              <Undo2 className="size-4" aria-hidden />
            ) : (
              <WandSparkles className="size-4" aria-hidden />
            )}
            {formatting
              ? t("sourceEditor.formatting")
              : prettierApplied
                ? t("sourceEditor.unprettier")
                : t("sourceEditor.prettier")}
          </Button>
        ) : null}
      </div>
      <div ref={host} className="source-code-editor-host min-h-64" />
    </div>
  );
}
