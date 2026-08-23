-- Maps WikiHub's semantic export markup (callouts, toggle sections) onto
-- named Word paragraph styles, so the python-docx post-pass in
-- app/modules/pages/export_docx.py can paint them with the page's real,
-- currently-rendered colors. No color lives here - only the mapping from a
-- data-type/data-callout-type attribute to a style name.

local CALLOUT_STYLES = {
  info = "WikiHub Callout Info",
  warning = "WikiHub Callout Warning",
  note = "WikiHub Callout Note",
  tip = "WikiHub Callout Note",
  panel = "WikiHub Callout Panel",
  expand = "WikiHub Callout Panel",
}

-- pandoc's HTML reader keeps "data-type" verbatim but strips the "data-"
-- prefix from every other data-* attribute (confirmed empirically, not
-- documented) - so "data-callout-type" arrives as plain "callout-type".
-- Both spellings are checked below so this does not depend on that quirk
-- holding across every pandoc version.
local function attr(el, name)
  return el.attributes["data-" .. name] or el.attributes[name]
end

function Div(el)
  local dataType = el.attributes["data-type"]

  if dataType == "callout" then
    local kind = attr(el, "callout-type") or "panel"
    el.attributes["custom-style"] = CALLOUT_STYLES[kind] or CALLOUT_STYLES["panel"]
    return el
  end

  if dataType == "toggle-summary" then
    el.attributes["custom-style"] = "WikiHub Toggle Summary"
    return el
  end

  if dataType == "toggle-content" then
    el.attributes["custom-style"] = "WikiHub Toggle Body"
    return el
  end

  return el
end
