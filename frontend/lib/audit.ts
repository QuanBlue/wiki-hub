export interface ChangeDiffRow {
  field: string;
  from: unknown;
  to: unknown;
}

export function extractChangeDiffs(
  changes: Record<string, { from?: unknown; to?: unknown }> | null | undefined,
): ChangeDiffRow[] {
  if (!changes || typeof changes !== "object") return [];
  const rows: ChangeDiffRow[] = [];

  for (const [key, pair] of Object.entries(changes)) {
    const fromVal = pair?.from;
    const toVal = pair?.to;

    if (
      fromVal &&
      toVal &&
      typeof fromVal === "object" &&
      typeof toVal === "object" &&
      !Array.isArray(fromVal) &&
      !Array.isArray(toVal)
    ) {
      const fromObj = fromVal as Record<string, unknown>;
      const toObj = toVal as Record<string, unknown>;
      const allKeys = Array.from(new Set([...Object.keys(fromObj), ...Object.keys(toObj)]));
      let subDiffs = 0;

      for (const subKey of allKeys) {
        const subFrom = fromObj[subKey];
        const subTo = toObj[subKey];
        if (JSON.stringify(subFrom) !== JSON.stringify(subTo)) {
          rows.push({
            field: `${key}.${subKey}`,
            from: subFrom,
            to: subTo,
          });
          subDiffs++;
        }
      }

      if (subDiffs === 0) {
        rows.push({ field: key, from: fromVal, to: toVal });
      }
    } else {
      rows.push({ field: key, from: fromVal, to: toVal });
    }
  }

  return rows;
}
