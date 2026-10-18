/**
 * CsvTableViewer.tsx
 * High-performance, theme-aware tabular data viewer for CSV and TSV files.
 * Provides sticky header, sticky row numbers, search/filtering, and cell copy.
 */
import { memo, useState, useMemo, useCallback } from "react";
import { Search, Check } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface Props {
  content: string;
  isTsv?: boolean;
  isDark?: boolean;
  className?: string;
}

/**
 * Robust RFC 4180 CSV / TSV parser that supports quoted values and multiline fields.
 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
          continue;
        } else {
          // End quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      } else if (char === "\r") {
        if (nextChar === "\n") {
          i++;
        }
        currentRow.push(currentField);
        currentField = "";
        if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else if (char === "\n") {
        currentRow.push(currentField);
        currentField = "";
        if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Push remainder
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export const CsvTableViewer = memo(function CsvTableViewer({
  content,
  isTsv = false,
  isDark = false,
  className = "",
}: Props) {
  const { t } = useTranslation("preview");
  const [filterQuery, setFilterQuery] = useState("");
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const delimiter = isTsv ? "\t" : ",";

  const allRows = useMemo(() => {
    return parseDelimited(content, delimiter);
  }, [content, delimiter]);

  const headers = useMemo(() => {
    if (allRows.length === 0) return [];
    return allRows[0];
  }, [allRows]);

  const dataRows = useMemo(() => {
    if (allRows.length <= 1) return [];
    return allRows.slice(1);
  }, [allRows]);

  const filteredRows = useMemo(() => {
    if (!filterQuery.trim()) return dataRows;
    const q = filterQuery.toLowerCase();
    return dataRows.filter((row) =>
      row.some((cell) => cell.toLowerCase().includes(q))
    );
  }, [dataRows, filterQuery]);

  const handleCopyCell = useCallback((val: string, key: string) => {
    navigator.clipboard.writeText(val);
    setCopiedCell(key);
    toast.success(t("csv.toast.copied"));
    setTimeout(() => setCopiedCell(null), 1500);
  }, [t]);

  const totalCols = headers.length;

  // Convert column index to spreadsheet letter (0 -> A, 1 -> B, 26 -> AA)
  const getColLetter = (idx: number) => {
    let letter = "";
    let temp = idx;
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  };

  return (
    <div
      className={`h-full w-full flex flex-col select-text ${className}`}
      style={{
        background: isDark ? "#131314" : "#f8fafd",
        color: isDark ? "#e3e3e3" : "#1f1f1f",
      }}
    >
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b gap-3 shrink-0"
        style={{
          background: isDark ? "#1e1f20" : "#ffffff",
          borderColor: isDark ? "#333537" : "#e0e2e7",
        }}
      >
        <div className="flex items-center gap-2 max-w-sm flex-1">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border flex-1 text-xs"
            style={{
              background: isDark ? "#282a2c" : "#f0f4f9",
              borderColor: isDark ? "#3c4043" : "#e0e2e7",
            }}
          >
            <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <input
              type="text"
              placeholder={t("csv.filterPlaceholder", { count: dataRows.length })}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="bg-transparent border-0 outline-none w-full text-xs"
              style={{ color: isDark ? "#e3e3e3" : "#1f1f1f" }}
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery("")}
                className="text-[10px] opacity-60 hover:opacity-100 cursor-pointer"
              >
                {t("csv.clear")}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono opacity-70">
          <span>
            {t("csv.rowsShown", { shown: filteredRows.length, count: dataRows.length })}
          </span>
          <span>·</span>
          <span>{t("csv.columns", { count: totalCols })}</span>
        </div>
      </div>

      {/* ── Grid Container ──────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-auto relative"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: isDark ? "#334155 transparent" : "#cbd5e1 transparent",
        }}
      >
        {allRows.length === 0 ? (
          <div className="h-full flex items-center justify-center opacity-60 text-sm">
            {t("csv.empty")}
          </div>
        ) : (
          <table
            className="w-full border-collapse text-xs font-mono"
            style={{ minWidth: `${Math.max(totalCols * 140, 600)}px` }}
          >
            {/* Sticky Header Row */}
            <thead
              className="sticky top-0 z-20 shadow-xs"
              style={{
                background: isDark ? "#1e1f20" : "#f0f4f9",
              }}
            >
              <tr>
                {/* Row Number Header corner */}
                <th
                  className="sticky left-0 z-30 p-2 text-center text-[10px] font-bold border-b border-r select-none w-14"
                  style={{
                    background: isDark ? "#282a2c" : "#e9eef6",
                    borderColor: isDark ? "#3c4043" : "#d3d7de",
                    color: isDark ? "#9aa0a6" : "#5f6368",
                  }}
                >
                  #
                </th>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="p-2.5 text-left font-semibold border-b border-r truncate max-w-[300px]"
                    style={{
                      borderColor: isDark ? "#3c4043" : "#d3d7de",
                      color: isDark ? "#e3e3e3" : "#1f1f1f",
                    }}
                    title={h}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate">{h || t("csv.columnFallback", { letter: getColLetter(i) })}</span>
                      <span
                        className="text-[9px] font-normal px-1 py-0.5 rounded opacity-60"
                        style={{ background: isDark ? "#333537" : "#dfe3eb" }}
                      >
                        {getColLetter(i)}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            {/* Table Body */}
            <tbody>
              {filteredRows.map((row, rIdx) => {
                const isEven = rIdx % 2 === 0;
                return (
                  <tr
                    key={rIdx}
                    className="transition-colors group hover:bg-blue-500/10"
                    style={{
                      background: isEven
                        ? isDark
                          ? "#131314"
                          : "#ffffff"
                        : isDark
                        ? "#18191a"
                        : "#f8fafd",
                    }}
                  >
                    {/* Sticky Row Number */}
                    <td
                      className="sticky left-0 z-10 p-2 text-center text-[10px] font-bold border-b border-r select-none"
                      style={{
                        background: isEven
                          ? isDark
                            ? "#1e1f20"
                            : "#f0f4f9"
                          : isDark
                          ? "#242527"
                          : "#e9eef6",
                        borderColor: isDark ? "#2e3134" : "#e0e3e7",
                        color: isDark ? "#80868b" : "#5f6368",
                      }}
                    >
                      {rIdx + 1}
                    </td>

                    {/* Data Cells */}
                    {headers.map((_, cIdx) => {
                      const cellVal = row[cIdx] ?? "";
                      const cellKey = `${rIdx}-${cIdx}`;
                      const isCopied = copiedCell === cellKey;

                      return (
                        <td
                          key={cIdx}
                          onClick={() => handleCopyCell(cellVal, cellKey)}
                          title={t("csv.cellTitle", { value: cellVal })}
                          className="p-2.5 border-b border-r truncate max-w-[320px] cursor-pointer hover:bg-blue-500/15 relative"
                          style={{
                            borderColor: isDark ? "#2e3134" : "#e0e3e7",
                          }}
                        >
                          <span className="truncate block">{cellVal}</span>
                          {isCopied && (
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-emerald-500 font-bold text-[10px] flex items-center gap-0.5 bg-emerald-500/10 px-1 rounded">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
