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
  //
  // RootLayout registers 25+ Google Font presets (~150 .woff2 files), but any
  // single page only ever renders with at most two or three of them. Once
  // ExportShell has awaited `document.fonts.ready`, Chromium has already
  // fetched the exact .woff2 subsets the document's characters and styles
  // actually use. When resource timing is available, only those loaded font
  // files are inlined (and unused @font-face rules are dropped), keeping an
  // exported HTML file ~150 KB instead of 6+ MB.
  const woff2Pattern = /url\((["']?)([^"')]+\.woff2)\1\)/g;
  const fontDataUris = new Map();
  const loadedWoff2 = new Set(
    (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
      ? performance.getEntriesByType('resource')
      : []
    )
      .map((entry) => entry.name)
      .filter((name) => typeof name === 'string' && name.includes('.woff2')),
  );

  async function inlineFont(rawUrl, baseHref) {
    let absoluteUrl;
    try {
      absoluteUrl = new URL(rawUrl, baseHref).href;
    } catch (error) {
      return null;
    }
    if (loadedWoff2.size > 0 && !loadedWoff2.has(absoluteUrl)) {
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
    const baseHref = sheet.href || document.baseURI;
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        const ruleText = rule.cssText;
        if (loadedWoff2.size > 0 && ruleText.startsWith('@font-face')) {
          const matches = Array.from(ruleText.matchAll(woff2Pattern));
          const isUsed = matches.some((m) => {
            try {
              return loadedWoff2.has(new URL(m[2], baseHref).href);
            } catch {
              return false;
            }
          });
          if (!isUsed) continue;
        }
        sheetCss += ruleText + '\n';
      }
    } catch (error) {
      // Unreadable (e.g. cross-origin) sheet - skip it.
      continue;
    }

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
  rootClone.querySelectorAll('.mermaid-render-output').forEach((el) => {
    el.removeAttribute('title');
    el.classList.remove('cursor-zoom-in');
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
async () => {
  const root = document.querySelector('[data-export-root]');
  if (!root) {
    throw new Error('export root not found');
  }

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = 1;
  colorCanvas.height = 1;
  const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });

  function normalizeCssColor(value) {
    if (
      !value ||
      /^#[0-9a-fA-F]{6}$/.test(value) ||
      /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(value)
    ) {
      return value;
    }
    if (!colorCtx) return value;
    try {
      colorCtx.fillStyle = '#ffffff';
      colorCtx.fillRect(0, 0, 1, 1);
      colorCtx.fillStyle = value;
      colorCtx.fillRect(0, 0, 1, 1);
      const data = colorCtx.getImageData(0, 0, 1, 1).data;
      return 'rgb(' + data[0] + ', ' + data[1] + ', ' + data[2] + ')';
    } catch {
      return value;
    }
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
    return cssProp.includes('color') ? normalizeCssColor(value) : value;
  }

  function readRootVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const diagramImages = [];
  const diagramEls = Array.from(document.querySelectorAll('[data-type="diagram"]'));
  for (const el of diagramEls) {
    const svg = el.querySelector('svg');
    if (!svg) {
      diagramImages.push('');
      continue;
    }
    try {
      const clone = svg.cloneNode(true);
      if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      if (!clone.getAttribute('xmlns:xlink')) {
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      }
      let width = 800;
      let height = 600;
      const viewBox = clone.getAttribute('viewBox') || clone.getAttribute('viewbox');
      if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          width = parts[2];
          height = parts[3];
        }
      } else {
        const rect = svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          width = Math.round(rect.width);
          height = Math.round(rect.height);
        }
      }
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      clone.removeAttribute('style');

      // Chromium taints a canvas whenever an <svg> containing <foreignObject>
      // is drawn onto it, causing canvas.toDataURL() to throw SecurityError.
      // Replace each <foreignObject> label with a native SVG <text> node first.
      for (const fo of Array.from(clone.querySelectorAll('foreignObject'))) {
        const textContent = (fo.textContent || '').trim();
        const foX = parseFloat(fo.getAttribute('x') || '0');
        const foY = parseFloat(fo.getAttribute('y') || '0');
        const foW = parseFloat(fo.getAttribute('width') || '0');
        const foH = parseFloat(fo.getAttribute('height') || '0');
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', String(foX + foW / 2));
        textEl.setAttribute('y', String(foY + foH / 2));
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('dominant-baseline', 'middle');
        textEl.setAttribute('fill', '#161b24');
        textEl.setAttribute(
          'font-family',
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        );
        textEl.setAttribute('font-size', '13px');
        textEl.setAttribute('font-weight', '500');
        textEl.textContent = textContent;
        if (fo.parentNode) {
          fo.parentNode.replaceChild(textEl, fo);
        }
      }

      const svgString = new XMLSerializer().serializeToString(clone);
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
      const img = new Image();
      await new Promise((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = Math.max(200, Math.round(width * scale));
      canvas.height = Math.max(100, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        diagramImages.push(canvas.toDataURL('image/png'));
      } else {
        diagramImages.push('');
      }
    } catch {
      diagramImages.push('');
    }
  }

  return {
    _diagram_images: diagramImages,
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
