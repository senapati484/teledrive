import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRecoveryStore } from "@/stores/recoveryStore";
import { useFileStore } from "@/stores/fileStore";
import {
  scanIndexHistory,
  mergeIndexFromRecovery,
  type RecoverableFile,
  type RecoveryReport,
} from "@/lib/storage/recovery";
import { toast } from "sonner";

interface Group {
  at: number;
  entries: RecoverableFile[];
}

export default function RecoveryDialog() {
  const { t } = useTranslation("settings");
  const open = useRecoveryStore((s) => s.open);
  const channelId = useRecoveryStore((s) => s.channelId);
  const close = useRecoveryStore((s) => s.close);
  const queueState = useFileStore((s) => s.indexQueueState);
  const retryInSec = useFileStore((s) => s.indexQueueRetryInSec);

  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !channelId) return;
    const controller = new AbortController();
    setLoading(true);
    setReport(null);
    setSelected(new Set());

    scanIndexHistory(channelId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setReport(result);
        setSelected(new Set(result.recoverable.map((entry) => entry.file.id)));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("[RecoveryDialog] Scan failed:", err);
        toast.error(t("storage.recovery.failed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [open, channelId, t]);

  const groups = useMemo<Group[]>(() => {
    if (!report) return [];
    const byTime = new Map<number, RecoverableFile[]>();
    for (const entry of report.recoverable) {
      const list = byTime.get(entry.epochAt);
      if (list) list.push(entry);
      else byTime.set(entry.epochAt, [entry]);
    }
    return [...byTime.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([at, entries]) => ({ at, entries }));
  }, [report]);

  const toggleFile = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allRecoveredSelected =
    !!report &&
    report.recoverable.length > 0 &&
    report.recoverable.every((entry) => selected.has(entry.file.id));

  const toggleAll = () => {
    if (!report) return;
    setSelected(
      allRecoveredSelected
        ? new Set()
        : new Set(report.recoverable.map((entry) => entry.file.id))
    );
  };

  const toggleGroup = (group: Group) => {
    const ids = group.entries.map((e) => e.file.id);
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const restore = async () => {
    if (!report || !channelId || selected.size === 0) return;
    const files = report.recoverable
      .filter((e) => selected.has(e.file.id))
      .map((e) => e.file);
    const trustedMessageIds = new Set(
      report.recoverable
        .filter((e) => selected.has(e.file.id) && e.epochAt === -1)
        .map((e) => Number(e.file.messageId))
        .filter((id) => Number.isFinite(id) && id > 0)
    );
    setRestoring(true);
    try {
      const result = await mergeIndexFromRecovery(channelId, files, {
        trustedMessageIds,
      });
      if (result.restored === 0 && result.skipped === 0) {
        toast.info(t("storage.recovery.nothingNew"));
      } else if (result.skipped > 0) {
        toast.warning(
          t("storage.recovery.restoredPartial", {
            count: result.restored,
            skipped: result.skipped,
          })
        );
      } else {
        toast.success(
          t("storage.recovery.restored", { count: result.restored })
        );
      }
      close();
    } catch (err: any) {
      console.error("[RecoveryDialog] Restore failed:", err);
      toast.error(err?.message || t("storage.recovery.failed"));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("storage.recovery.title")}</DialogTitle>
          <DialogDescription>
            {t("storage.recovery.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200">
          <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t("storage.recovery.warning")}</span>
        </div>

        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400"
          >
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("storage.recovery.scanning")}
            </span>
            <span className="max-w-md text-center text-xs">
              {t("storage.recovery.scanningHint")}
            </span>
          </div>
        ) : groups.length === 0 ? (
          <p
            role="status"
            aria-live="polite"
            className="py-8 text-center text-sm text-slate-500 dark:text-slate-400"
          >
            {t("storage.recovery.empty")}
          </p>
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="max-h-[55vh] space-y-4 overflow-y-auto pr-1"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/70 dark:border-white/[0.08] px-3 py-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t("storage.recovery.selectedCount", {
                  selected: selected.size,
                  total: report?.recoverable.length ?? 0,
                })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={toggleAll}
              >
                {allRecoveredSelected
                  ? t("storage.recovery.selectNone")
                  : t("storage.recovery.selectAll")}
              </Button>
            </div>
            {groups.map((group) => {
              const allSelected = group.entries.every((e) =>
                selected.has(e.file.id)
              );
              return (
                <section key={group.at} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {group.at === -1
                        ? t("storage.recovery.channelFiles")
                        : group.at > 0
                          ? new Date(group.at).toLocaleString()
                          : t("storage.recovery.epochUnknown")}
                      <span className="ml-2 font-normal text-slate-400">
                        {t("storage.recovery.filesCount", {
                          count: group.entries.length,
                        })}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => toggleGroup(group)}
                    >
                      {allSelected
                        ? t("storage.recovery.selectNone")
                        : t("storage.recovery.selectAll")}
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {group.entries.map((entry) => (
                      <label
                        key={entry.file.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-[#0B57D0]"
                          checked={selected.has(entry.file.id)}
                          onChange={() => toggleFile(entry.file.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                          {entry.file.name}
                        </span>
                        <span className="max-w-[45%] truncate text-xs text-slate-400">
                          {entry.file.folderPath}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {restoring && queueState === "retrying" && retryInSec > 0 && (
          <p
            role="status"
            aria-live="polite"
            className="text-center text-xs text-amber-700 dark:text-amber-300"
          >
            {t("storage.recovery.rateLimited", { seconds: retryInSec })}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>
            {t("storage.recovery.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={restore}
            disabled={loading || restoring || selected.size === 0}
            className="gap-2"
          >
            {restoring ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {restoring
              ? t("storage.recovery.restoring")
              : t("storage.recovery.restore", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
