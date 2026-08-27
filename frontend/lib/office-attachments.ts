const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docm",
  "docx",
  "dotx",
  "ppt",
  "pptm",
  "pptx",
  "potx",
  "odp",
  "xls",
  "xlsm",
  "xlsx",
  "xltx",
  "ods",
]);

export function isOfficeAttachment(filename: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return OFFICE_EXTENSIONS.has(extension);
}

export function isEditableOfficeAttachment(filename: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return extension === "docx" || extension === "xlsx";
}
