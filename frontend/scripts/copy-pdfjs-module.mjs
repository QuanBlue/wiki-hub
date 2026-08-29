/**
 * Copy the PDF.js ES module build into public/vendor/pdfjs/.
 *
 * @aiden0z/pptx-renderer renders EMF images that embed a PDF preview (the
 * common case for pasted vector art / SmartArt fallback images) by loading
 * PDF.js *inside a dedicated blob Worker* via `import(moduleUrl)`. That import
 * needs a real, fetchable URL - a bundler-resolved module reference doesn't
 * work there - so the module build has to live as a static asset, the same
 * way @lamberl-lee/file-preview already vendors the PDF.js worker.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let modulePath;
try {
  modulePath = require.resolve("pdfjs-dist/build/pdf.min.mjs");
} catch {
  console.log(
    "[wikihub] pdfjs-dist not installed — skipping PDF.js module copy. " +
      "EMF-embedded PDF previews in PowerPoint attachments will be skipped.",
  );
  process.exit(0);
}

const targetDir = path.resolve("public/vendor/pdfjs");
const targetPath = path.join(targetDir, "pdf.min.mjs");

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(modulePath, targetPath);

console.log(`Copied PDF.js module to ${targetPath}`);
