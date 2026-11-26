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

local function flatten_callout_lists(blocks)
  local out = pandoc.List()
  for _, block in ipairs(blocks) do
    if block.t == "BulletList" then
      for _, item in ipairs(block.content) do
        for i, sub in ipairs(item) do
          if i == 1 and (sub.t == "Plain" or sub.t == "Para") then
            local inlines = pandoc.List({pandoc.Str("• ")})
            inlines:extend(sub.content)
            out:insert(pandoc.Para(inlines))
          else
            out:insert(sub)
          end
        end
      end
    elseif block.t == "OrderedList" then
      for idx, item in ipairs(block.content) do
        for i, sub in ipairs(item) do
          if i == 1 and (sub.t == "Plain" or sub.t == "Para") then
            local inlines = pandoc.List({pandoc.Str(tostring(idx) .. ". ")})
            inlines:extend(sub.content)
            out:insert(pandoc.Para(inlines))
          else
            out:insert(sub)
          end
        end
      end
    else
      out:insert(block)
    end
  end
  return out
end

function Div(el)
  local dataType = el.attributes["data-type"]

  if dataType == "callout" then
    local kind = attr(el, "callout-type") or "panel"
    el.attributes["custom-style"] = CALLOUT_STYLES[kind] or CALLOUT_STYLES["panel"]
    el.content = flatten_callout_lists(el.content)
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
