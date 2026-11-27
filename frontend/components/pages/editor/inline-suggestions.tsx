"use client";

import { Extension, type Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { Calendar, FileText, User as UserIcon } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MentionCandidate, WikiPage } from "@/types/api";

/* -------------------------------------------------------------------------- */
/* Shared runtime store so Suggestion plugins can read active space context   */
/* -------------------------------------------------------------------------- */

export interface InlineSuggestionRuntimeContext {
  spaceKey: string;
  pageSlug: string | null;
  pages: WikiPage[];
}

let activeContext: InlineSuggestionRuntimeContext | null = null;

export function setInlineSuggestionContext(
  ctx: InlineSuggestionRuntimeContext | null,
) {
  activeContext = ctx;
}

function activeLocale(): "en" | "vi" {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang === "vi" ? "vi" : "en";
}

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* -------------------------------------------------------------------------- */
/* 1. @ Mention & Date Suggestion                                             */
/* -------------------------------------------------------------------------- */

type MentionItem =
  | {
      kind: "date";
      id: string;
      label: string;
      sublabel: string;
      datetime: string;
    }
  | {
      kind: "user";
      id: string;
      username: string;
      label: string;
      canView: boolean;
    };

interface SuggestionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<
  SuggestionListRef,
  {
    items: MentionItem[];
    command: (item: MentionItem) => void;
  }
>(function MentionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isVi = activeLocale() === "vi";

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + items.length - 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const picked = items[selectedIndex];
        if (picked) {
          command(picked);
          return true;
        }
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="border-border bg-surface-raised text-muted-foreground w-64 rounded-lg border p-2.5 text-xs shadow-lg">
        {isVi ? "Không tìm thấy người dùng hoặc ngày phù hợp" : "No matching people or dates"}
      </div>
    );
  }

  return (
    <div className="border-border bg-surface-raised max-h-64 w-68 overflow-y-auto rounded-lg border p-1 text-xs shadow-lg">
      {items.map((item, idx) => {
        const active = idx === selectedIndex;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(idx)}
            className={cn(
              "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              active
                ? "bg-surface-selected text-foreground"
                : "text-foreground hover:bg-surface-hover",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {item.kind === "date" ? (
                <Calendar className="text-primary size-3.5 shrink-0" />
              ) : (
                <UserIcon className="text-primary size-3.5 shrink-0" />
              )}
              <span className="truncate font-medium">{item.label}</span>
            </span>
            <span className="text-muted-foreground shrink-0 text-[11px]">
              {item.kind === "date" ? item.sublabel : `@${item.username}`}
            </span>
          </button>
        );
      })}
    </div>
  );
});

const MENTION_PLUGIN_KEY = new PluginKey("wikihubInlineMention");

function createFloatingPopupRenderer<T>(
  Component: typeof MentionList | typeof WikiLinkList,
) {
  return () => {
    let component: ReactRenderer<SuggestionListRef> | null = null;
    let popup: HTMLDivElement | null = null;

    const position = (props: SuggestionProps<T>) => {
      if (!popup || !props.clientRect) return;
      const rect = props.clientRect();
      if (!rect) return;
      popup.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
      popup.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 280)}px`;
    };

    return {
      onStart: (props: SuggestionProps<T>) => {
        component = new ReactRenderer(Component as never, {
          props,
          editor: props.editor,
        });
        popup = document.createElement("div");
        popup.style.position = "fixed";
        popup.style.zIndex = "60";
        popup.appendChild(component.element);
        document.body.appendChild(popup);
        position(props);
      },
      onUpdate: (props: SuggestionProps<T>) => {
        component?.updateProps(props);
        position(props);
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === "Escape") {
          popup?.remove();
          popup = null;
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        popup?.remove();
        popup = null;
        component?.destroy();
        component = null;
      },
    };
  };
}

export const InlineMentionSuggestion = Extension.create({
  name: "inlineMentionSuggestion",

  addProseMirrorPlugins() {
    return [
      Suggestion<MentionItem>({
        pluginKey: MENTION_PLUGIN_KEY,
        editor: this.editor,
        char: "@",
        allowSpaces: false,
        items: async ({ query }) => {
          const isVi = activeLocale() === "vi";
          const q = query.trim().toLowerCase();
          const allDateItems: MentionItem[] = [
            {
              kind: "date",
              id: "date-today",
              label: isVi ? "Hôm nay (today)" : "Today",
              sublabel: isoDateOffset(0),
              datetime: isoDateOffset(0),
            },
            {
              kind: "date",
              id: "date-tomorrow",
              label: isVi ? "Ngày mai (tomorrow)" : "Tomorrow",
              sublabel: isoDateOffset(1),
              datetime: isoDateOffset(1),
            },
            {
              kind: "date",
              id: "date-yesterday",
              label: isVi ? "Hôm qua (yesterday)" : "Yesterday",
              sublabel: isoDateOffset(-1),
              datetime: isoDateOffset(-1),
            },
          ];
          const dateItems: MentionItem[] = allDateItems.filter(
            (d) =>
              d.kind === "date" &&
              (!q ||
                d.label.toLowerCase().includes(q) ||
                d.datetime.includes(q)),
          );

          const userItems: MentionItem[] = [];
          if (activeContext?.spaceKey && activeContext.pageSlug) {
            try {
              const candidates = await api.get<MentionCandidate[]>(
                `/api/v1/spaces/${encodeURIComponent(activeContext.spaceKey)}/pages/${encodeURIComponent(activeContext.pageSlug)}/comments/mentionable?q=${encodeURIComponent(query)}`,
              );
              for (const c of candidates.slice(0, 8)) {
                userItems.push({
                  kind: "user",
                  id: `user-${c.username}`,
                  username: c.username,
                  label: c.full_name || c.username,
                  canView: c.can_view,
                });
              }
            } catch {
              // ignore fetch errors while typing
            }
          }
          return [...userItems, ...dateItems].slice(0, 10);
        },
        command: ({ editor, range, props }) => {
          const chain = (editor as Editor).chain().focus().deleteRange(range);
          if (props.kind === "date") {
            chain
              .insertContent([
                { type: "dateChip", attrs: { datetime: props.datetime } },
                { type: "text", text: " " },
              ])
              .run();
          } else {
            chain
              .insertContent([
                {
                  type: "userMention",
                  attrs: { username: props.username, label: props.label },
                },
                { type: "text", text: " " },
              ])
              .run();
          }
        },
        render: createFloatingPopupRenderer<MentionItem>(MentionList),
      }),
    ];
  },
});

/* -------------------------------------------------------------------------- */
/* 2. [[ Quick Page Link Suggestion                                           */
/* -------------------------------------------------------------------------- */

interface PageLinkItem {
  id: string;
  title: string;
  slug: string;
  spaceKey: string;
}

const WikiLinkList = forwardRef<
  SuggestionListRef,
  {
    items: PageLinkItem[];
    command: (item: PageLinkItem) => void;
  }
>(function WikiLinkList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isVi = activeLocale() === "vi";

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + items.length - 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const picked = items[selectedIndex];
        if (picked) {
          command(picked);
          return true;
        }
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="border-border bg-surface-raised text-muted-foreground w-72 rounded-lg border p-2.5 text-xs shadow-lg">
        {isVi ? "Không tìm thấy trang nào khớp" : "No matching pages found"}
      </div>
    );
  }

  return (
    <div className="border-border bg-surface-raised max-h-64 w-72 overflow-y-auto rounded-lg border p-1 text-xs shadow-lg">
      <div className="text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wider uppercase">
        {isVi ? "Chèn liên kết trang" : "Link to page"}
      </div>
      {items.map((item, idx) => {
        const active = idx === selectedIndex;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(idx)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              active
                ? "bg-surface-selected text-foreground"
                : "text-foreground hover:bg-surface-hover",
            )}
          >
            <FileText className="text-primary size-3.5 shrink-0" />
            <span className="truncate font-medium">{item.title}</span>
          </button>
        );
      })}
    </div>
  );
});

const WIKI_LINK_PLUGIN_KEY = new PluginKey("wikihubWikiLinkSuggestion");

export const WikiLinkSuggestion = Extension.create({
  name: "wikiLinkSuggestion",

  addProseMirrorPlugins() {
    return [
      Suggestion<PageLinkItem>({
        pluginKey: WIKI_LINK_PLUGIN_KEY,
        editor: this.editor,
        char: "[[",
        allowSpaces: true,
        items: ({ query }) => {
          if (!activeContext) return [];
          const q = query.trim().toLowerCase();
          return activeContext.pages
            .filter(
              (p) =>
                !q ||
                p.title.toLowerCase().includes(q) ||
                p.slug.toLowerCase().includes(q),
            )
            .slice(0, 10)
            .map((p) => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              spaceKey: activeContext!.spaceKey,
            }));
        },
        command: ({ editor, range, props }) => {
          const href = `/spaces/${encodeURIComponent(props.spaceKey)}/pages/${encodeURIComponent(props.slug)}`;
          (editor as Editor)
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: "text",
                text: props.title,
                marks: [{ type: "link", attrs: { href } }],
              },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: createFloatingPopupRenderer<PageLinkItem>(WikiLinkList),
      }),
    ];
  },
});
