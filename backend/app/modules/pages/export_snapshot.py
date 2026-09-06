"""JavaScript executed inside the headless browser (via ``Page.evaluate``) to
turn the live-rendered /print page into one self-contained HTML document.

Every same-origin stylesheet (Tailwind's compiled output, globals.css,
next/font's generated ``@font-face`` rules) is concatenated into a single
``<style>``, and every webfont file that CSS actually references is fetched
and inlined as a ``data:`` URI - the exported file then has zero runtime
dependency on the app's own static asset server, and looks identical whether
opened online or completely offline.
"""

#: Evaluated as `await page.evaluate(SNAPSHOT_JS)`; Playwright awaits an
#: async function expression's returned promise automatically.
SNAPSHOT_JS = r"""
async () => {
  const root = document.querySelector('[data-export-root]');
  if (!root) {
    throw new Error('export root not found');
  }

  // A stylesheet serializes its own url(...) references relative to *its
  // own* location (next/font's generated CSS uses "../media/xyz.woff2"), not
  // to the page - so each sheet's base href is what resolves it correctly.
  // Fonts are fetched once even when several sheets reference the same file.
  const woff2Pattern = /url\((["']?)([^"')]+\.woff2)\1\)/g;
  const fontDataUris = new Map();

  async function inlineFont(rawUrl, baseHref) {
    let absoluteUrl;
    try {
      absoluteUrl = new URL(rawUrl, baseHref).href;
    } catch (error) {
      return null;
    }
    if (fontDataUris.has(absoluteUrl)) {
      return fontDataUris.get(absoluteUrl);
    }
    let dataUri = null;
    try {
      const response = await fetch(absoluteUrl);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      dataUri = 'data:font/woff2;base64,' + btoa(binary);
    } catch (error) {
      // A font that fails to inline just falls back to the next family in
      // the stack; it does not fail the export.
    }
    fontDataUris.set(absoluteUrl, dataUri);
    return dataUri;
  }

  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let sheetCss = '';
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        sheetCss += rule.cssText + '\n';
      }
    } catch (error) {
      // Unreadable (e.g. cross-origin) sheet - skip it.
      continue;
    }

    const baseHref = sheet.href || document.baseURI;
    for (const match of Array.from(sheetCss.matchAll(woff2Pattern))) {
      const dataUri = await inlineFont(match[2], baseHref);
      if (dataUri) {
        sheetCss = sheetCss.split(match[0]).join('url("' + dataUri + '")');
      }
    }
    css += sheetCss;
  }

  const rootClone = root.cloneNode(true);
  rootClone.querySelectorAll('script, noscript, link').forEach((el) => el.remove());
  rootClone.querySelectorAll('[contenteditable]').forEach((el) => {
    el.removeAttribute('contenteditable');
  });

  const htmlStyle = (document.documentElement.getAttribute('style') || '').replace(/"/g, '&quot;');
  const htmlClass = document.documentElement.className || '';
  const title = (document.title || '').replace(/</g, '&lt;');

  return (
    '<!doctype html>\n' +
    '<html lang="en" class="' + htmlClass + '" style="' + htmlStyle + '">\n' +
    '<head><meta charset="utf-8"><title>' + title + '</title>' +
    '<style>' + css + '</style></head>\n' +
    '<body>' + rootClone.outerHTML + '</body>\n' +
    '</html>'
  );
}
"""

#: Evaluated as `await page.evaluate(THEME_PROBE_JS)` for Word export.
#:
#: Word's HTML *structure* comes from the same sanitized, semantic markup
#: PDF/HTML export already prepares server-side (export_content.py's
#: prepare_export_html - real <pre><code class="language-x">, real
#: data-type="callout"/"toggle" divs, exactly what TipTap's own renderHTML
#: serializes when a page is saved) rather than from this live page's
#: rendered DOM: several node types (callout, toggle, code block) render
#: on screen through a custom React node view whose visual markup does not
#: carry those same semantic attributes, so cloning the live DOM for
#: *structure* silently loses them. The live page is still the right, and
#: only reliable, source for *color* - getComputedStyle here resolves every
#: var()/color-mix() chain the CSS actually applies, off real or temporary
#: elements carrying the app's real classes, so this cannot drift from the
#: live theme the way a hand-written palette would.
THEME_PROBE_JS = r"""
() => {
  const root = document.querySelector('[data-export-root]');
  if (!root) {
    throw new Error('export root not found');
  }

  function probe(className, cssProp, tag) {
    const el = document.createElement(tag || 'div');
    el.className = className;
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    el.style.borderStyle = 'solid';
    el.style.borderWidth = '1px';
    document.body.appendChild(el);
    const value = getComputedStyle(el).getPropertyValue(cssProp).trim();
    document.body.removeChild(el);
    return value;
  }

  function readRootVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  return {
    font_page: getComputedStyle(root).fontFamily,
    font_mono: probe('wikihub-code', 'font-family', 'code'),
    foreground: readRootVar('--foreground'),
    primary: readRootVar('--primary'),
    border: readRootVar('--border'),
    table_header_bg: readRootVar('--surface-sunken'),
    code_bg: readRootVar('--wh-code-bg'),
    code_fg: readRootVar('--wh-code-fg'),
    code_comment: readRootVar('--wh-code-comment'),
    code_keyword: readRootVar('--wh-code-keyword'),
    code_string: readRootVar('--wh-code-string'),
    code_number: readRootVar('--wh-code-number'),
    code_function: readRootVar('--wh-code-function'),
    code_type: readRootVar('--wh-code-type'),
    code_variable: readRootVar('--wh-code-variable'),
    code_meta: readRootVar('--wh-code-meta'),
    callout_info_bg: probe('callout callout-info', 'background-color'),
    callout_info_border: probe('callout callout-info', 'border-color'),
    callout_warning_bg: probe('callout callout-warning', 'background-color'),
    callout_warning_border: probe('callout callout-warning', 'border-color'),
    callout_note_bg: probe('callout callout-note', 'background-color'),
    callout_note_border: probe('callout callout-note', 'border-color'),
    callout_panel_bg: probe('callout callout-panel', 'background-color'),
    callout_panel_border: probe('callout callout-panel', 'border-color'),
  };
}
"""
