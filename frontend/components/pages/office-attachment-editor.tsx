"use client";

import { Document, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import {
  Check,
  FileSpreadsheet,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type SpreadsheetState = {
  workbook: ExcelJS.Workbook;
  sheets: Record<string, string[][]>;
  names: string[];
};

export function OfficeAttachmentEditor({
  attachmentId,
  contentUrl,
  filename,
  contentType,
  onSaved,
  onCancel,
}: {
  attachmentId: string;
  contentUrl: string;
  filename: string;
  contentType: string;
  onSaved: (sizeBytes: number) => void;
  onCancel: () => void;
}) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const kind = extension === "xlsx" ? "xlsx" : "docx";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docText, setDocText] = useState("");
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetState | null>(null);
  const [activeSheet, setActiveSheet] = useState("");
  const workbookRef = useRef<ExcelJS.Workbook | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(contentUrl);
        if (!response.ok) throw new Error("Could not load the file for editing.");
        const buffer = await response.arrayBuffer();
        if (kind === "docx") {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ arrayBuffer: buffer });
          if (!cancelled) setDocText(result.value);
        } else {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer as never);
          const names = workbook.worksheets.map((sheet) => sheet.name);
          const sheets: Record<string, string[][]> = {};
          for (const sheet of workbook.worksheets) {
            const rows: string[][] = [];
            sheet.eachRow({ includeEmpty: true }, (row) => {
              const values = Array.isArray(row.values) ? row.values.slice(1) : [];
              rows.push(values.map((value) => (value == null ? "" : String(value))));
            });
            sheets[sheet.name] = rows;
          }
          workbookRef.current = workbook;
          if (!cancelled) {
            setSpreadsheet({ workbook, sheets, names });
            setActiveSheet(names[0] ?? "");
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the file.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [contentUrl, kind]);

  const activeRows = useMemo(
    () => spreadsheet?.sheets[activeSheet] ?? [],
    [activeSheet, spreadsheet],
  );

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    setSpreadsheet((current) => {
      if (!current) return current;
      const rows = current.sheets[activeSheet].map((row) => [...row]);
      while (rows.length <= rowIndex) rows.push([]);
      while (rows[rowIndex].length <= columnIndex) rows[rowIndex].push("");
      rows[rowIndex][columnIndex] = value;
      return { ...current, sheets: { ...current.sheets, [activeSheet]: rows } };
    });
  }

  async function save() {
    setSaving(true);
    try {
      let blob: Blob;
      if (kind === "docx") {
        const document = new Document({
          sections: [
            {
              children: docText.split(/\r?\n/).map(
                (line) => new Paragraph({ children: [new TextRun(line)] }),
              ),
            },
          ],
        });
        blob = await Packer.toBlob(document);
      } else {
        const workbook = workbookRef.current;
        if (!workbook || !spreadsheet) throw new Error("The spreadsheet is not ready.");
        for (const name of spreadsheet.names) {
          const worksheet = workbook.getWorksheet(name);
          if (!worksheet) continue;
          worksheet.spliceRows(1, worksheet.rowCount);
          for (const row of spreadsheet.sheets[name] ?? []) worksheet.addRow(row);
        }
        const output = await workbook.xlsx.writeBuffer();
        blob = new Blob([output as BlobPart], {
          type: contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      }

      const form = new FormData();
      form.append("file", blob, filename);
      const response = await fetch(`/api/v1/attachments/${attachmentId}/content`, {
        method: "PUT",
        body: form,
      });
      if (!response.ok) {
        const envelope = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(envelope?.error?.message ?? "Could not save the file.");
      }
      const saved = (await response.json()) as { size_bytes: number };
      toast.success("File saved.");
      onSaved(saved.size_bytes);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Could not save the file.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-80 items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading editor...
      </div>
    );
  }
  if (error) {
    return <div className="text-danger min-h-80 p-4 text-sm">{error}</div>;
  }

  return (
    <div className="flex min-h-80 min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {kind === "xlsx" ? <FileSpreadsheet className="size-4" /> : <FileText className="size-4" />}
          Editing a copy in the browser. Save to replace the attachment.
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="border-border hover:bg-surface-hover focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none">
            <X className="size-3.5" /> Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
          </button>
        </div>
      </div>

      {kind === "docx" ? (
        <textarea
          value={docText}
          onChange={(event) => setDocText(event.target.value)}
          className="border-border bg-background text-foreground focus-visible:ring-ring min-h-72 w-full resize-y rounded-md border p-4 font-sans text-sm leading-6 outline-none focus-visible:ring-2"
          aria-label={`Edit ${filename}`}
        />
      ) : (
        <div className="border-border min-w-0 overflow-auto rounded-md border">
          <div className="bg-surface-sunken flex min-w-max border-b px-2 pt-2">
            {spreadsheet?.names.map((name) => (
              <button key={name} type="button" onClick={() => setActiveSheet(name)} className={`border-border hover:bg-surface-hover focus-visible:ring-ring rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none ${activeSheet === name ? "bg-surface text-foreground" : "text-muted-foreground"}`}>
                {name}
              </button>
            ))}
          </div>
          <table className="min-w-full border-collapse text-xs">
            <tbody>
              {activeRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="bg-surface-sunken text-muted-foreground border-border w-10 border-r border-b px-2 py-1 text-center select-none">{rowIndex + 1}</td>
                  {row.map((value, columnIndex) => (
                    <td key={columnIndex} className="border-border min-w-32 border-r border-b p-0">
                      <input value={value} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} className="text-foreground focus:bg-primary-subtle h-8 w-full bg-transparent px-2 outline-none" aria-label={`Row ${rowIndex + 1}, column ${columnIndex + 1}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
