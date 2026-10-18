import { describe, expect, it } from "vitest";

import { matchNavigation } from "@/lib/search-navigation";
import type { Me } from "@/types/api";

const t = (key: string) => key;
const user = (extra: Partial<Me> = {}) =>
  ({ is_superuser: false, global_permissions: [], ...extra }) as Me;

const ids = (query: string, who: Me | null) =>
  matchNavigation(query, who, t).map((match) => match.entry.id);

describe("matchNavigation", () => {
  it("finds the password form from English or accent-free Vietnamese", () => {
    expect(ids("change password", user())).toContain("changePassword");
    expect(ids("doi mat khau", user())).toContain("changePassword");
    expect(ids("đổi mật khẩu", user())).toContain("changePassword");
  });

  it("offers user management only to someone who may open it", () => {
    expect(ids("manage users", user())).not.toContain("adminUsers");
    expect(ids("manage users", user({ global_permissions: ["manage_users"] }))).toContain("adminUsers");
    expect(ids("manage users", user({ is_superuser: true }))).toContain("adminUsers");
  });

  it("keeps a narrow permission to its own section", () => {
    const groups = user({ global_permissions: ["manage_groups"] });
    expect(ids("settings", groups)).not.toContain("settings");
    expect(ids("groups", groups)).toContain("adminGroups");
  });

  it("returns nothing without a user or a query", () => {
    expect(ids("password", null)).toEqual([]);
    expect(ids("   ", user())).toEqual([]);
  });
});

import { matchCommands, parseCommand } from "@/lib/search-navigation";

describe("commands", () => {
  const names = (name: string, who: Me | null, aiOn = false) =>
    matchCommands(name, who, t, aiOn).map((match) => match.entry.command);

  it("parses ':name rest' and ignores ordinary queries", () => {
    expect(parseCommand(":Help how to")).toEqual({ name: "help", rest: "how to" });
    expect(parseCommand(":")).toEqual({ name: "", rest: "" });
    expect(parseCommand("help")).toBeNull();
  });

  it("completes a command from its first letters", () => {
    expect(names("he", user())).toEqual(["help"]);
    expect(names("pass", user())).toEqual(["password"]);
  });

  it("hides admin commands and disables the AI ones while the assistant is off", () => {
    expect(names("users", user())).toEqual([]);
    expect(names("users", user({ is_superuser: true }))).toEqual(["users"]);
    const off = matchCommands("ask", user(), t, false)[0]!;
    expect(off.disabled).toBe(true);
    expect(off.hint).toBe("searchNav.aiOff");
    expect(matchCommands("ask", user(), t, true)[0]!.disabled).toBe(false);
  });
});

import { spaceKeyFromPath } from "@/lib/search-navigation";

describe(":trash", () => {
  it("knows the space a path is in", () => {
    expect(spaceKeyFromPath("/spaces/ENG/pages/home")).toBe("ENG");
    expect(spaceKeyFromPath("/spaces/A%20B")).toBe("A B");
    expect(spaceKeyFromPath("/help")).toBeNull();
    expect(spaceKeyFromPath(null)).toBeNull();
  });

  it("opens the Trash dialog of the space being looked at, and only inside a space", () => {
    const inSpace = matchCommands("tra", user(), t, false, "ENG");
    // No page to go to: it opens the space's Trash dialog.
    expect(inSpace.map((match) => [match.entry.id, match.entry.href])).toEqual([["trash", ""]]);
    expect(inSpace[0]!.label).toBe("searchNav.trash");
    expect(matchCommands("trash", user(), t, false)).toEqual([]);
  });
});
