import React from "react";
import { Download, ExternalLink, Sparkles, X, ArrowUpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { runtimeOpenUrl } from "@/lib/runtime/bridge";
import type { UpdateCheckResult } from "@/lib/support/updateChecker";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    stroke="currentColor"
    strokeWidth="2.2"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

interface UpdateAvailableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateCheckResult | null;
}

/**
 * Tokenizes and renders inline markdown:
 * - Markdown links [label](url)
 * - Bold **text**
 * - Inline code `code`
 * - Standalone URLs https://...
 * - GitHub mentions @user
 */
export function formatInline(text: string): React.ReactNode {
  const tokenRegex = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+|@[a-zA-Z0-9_-]+)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, i) => {
    if (!part) return null;

    // Markdown link: [label](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      return (
        <a
          key={i}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            runtimeOpenUrl(href).catch(() => {});
          }}
          className="text-[#0B57D0] dark:text-[#8ab4f8] underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-0.5 cursor-pointer font-medium"
          title={href}
        >
          <span>{label}</span>
          <ExternalLink className="h-2.5 w-2.5 inline ml-0.5 opacity-60" />
        </a>
      );
    }

    // Bold
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-slate-900 dark:text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // Inline code
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.08] font-mono text-[11px] text-blue-600 dark:text-blue-300 border border-slate-200/70 dark:border-white/[0.08]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bare URL
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={i}
          href={part}
          onClick={(e) => {
            e.preventDefault();
            runtimeOpenUrl(part).catch(() => {});
          }}
          className="text-[#0B57D0] dark:text-[#8ab4f8] underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-0.5 cursor-pointer"
        >
          <span className="truncate max-w-[220px] inline-block align-bottom">{part}</span>
          <ExternalLink className="h-2.5 w-2.5 inline ml-0.5 opacity-60" />
        </a>
      );
    }

    // GitHub @mention
    if (/^@[a-zA-Z0-9_-]+$/.test(part)) {
      const username = part.slice(1);
      const userUrl = `https://github.com/${username}`;
      return (
        <a
          key={i}
          href={userUrl}
          onClick={(e) => {
            e.preventDefault();
            runtimeOpenUrl(userUrl).catch(() => {});
          }}
          className="font-medium text-slate-700 dark:text-slate-300 hover:text-[#0B57D0] dark:hover:text-[#8ab4f8] cursor-pointer"
        >
          {part}
        </a>
      );
    }

    return part;
  });
}

/**
 * Parses markdown release notes into clean React nodes with headers, lists, and paragraphs.
 * Strips redundant top-level title that duplicates the modal header.
 */
export function renderReleaseNotes(notes: string) {
  if (!notes) return null;

  const lines = notes.split("\n");
  const parsedNodes: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = (keyPrefix: number) => {
    if (inList && listItems.length > 0) {
      parsedNodes.push(
        <ul key={`list-${keyPrefix}`} className="space-y-1.5 my-2.5 pl-0.5">
          {listItems}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  let seenFirstHeading = false;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList(idx);
      return;
    }

    // Skip top header if it repeats TeleDrive release title
    if (!seenFirstHeading && /^#\s+(?:🚀\s*)?TeleDrive/i.test(trimmed)) {
      seenFirstHeading = true;
      return;
    }

    if (trimmed.startsWith("# ")) {
      seenFirstHeading = true;
      flushList(idx);
      parsedNodes.push(
        <h3
          key={idx}
          className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white mt-4 mb-2 pb-1 border-b border-slate-200/60 dark:border-white/[0.06]"
        >
          {trimmed.replace(/^#\s+/, "")}
        </h3>
      );
      return;
    }

    if (trimmed.startsWith("### ")) {
      flushList(idx);
      parsedNodes.push(
        <h4
          key={idx}
          className="text-xs font-bold uppercase tracking-wider text-[#0B57D0] dark:text-[#8ab4f8] mt-3.5 mb-2 flex items-center gap-2"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#0B57D0] dark:bg-[#8ab4f8]" />
          <span>{trimmed.replace(/^###\s+/, "")}</span>
        </h4>
      );
      return;
    }

    if (trimmed.startsWith("## ")) {
      flushList(idx);
      parsedNodes.push(
        <h3
          key={idx}
          className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white mt-4 mb-2 pb-1 border-b border-slate-200/60 dark:border-white/[0.06] flex items-center gap-2"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          <span>{trimmed.replace(/^##\s+/, "")}</span>
        </h3>
      );
      return;
    }

    if (/^[-*•+]\s+/.test(trimmed)) {
      inList = true;
      const text = trimmed.replace(/^[-*•+]\s+/, "");
      listItems.push(
        <li key={idx} className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-[#0B57D0] dark:bg-[#8ab4f8] shrink-0 mt-1.5 shadow-xs" />
          <span className="flex-1 leading-relaxed">{formatInline(text)}</span>
        </li>
      );
      return;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushList(idx);
      const match = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (match) {
        parsedNodes.push(
          <div key={idx} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 my-1.5 pl-0.5">
            <span className="font-mono text-[11px] font-semibold text-blue-600 dark:text-blue-400 shrink-0">
              {match[1]}.
            </span>
            <span className="flex-1 leading-relaxed">{formatInline(match[2])}</span>
          </div>
        );
        return;
      }
    }

    if (trimmed.startsWith("> ")) {
      flushList(idx);
      parsedNodes.push(
        <blockquote
          key={idx}
          className="px-3.5 py-2 my-2 rounded-xl bg-slate-100/70 dark:bg-white/[0.04] border border-slate-200/60 dark:border-white/[0.06] text-xs italic text-slate-700 dark:text-slate-200 leading-relaxed"
        >
          {formatInline(trimmed.replace(/^>\s*/, ""))}
        </blockquote>
      );
      return;
    }

    flushList(idx);
    parsedNodes.push(
      <p key={idx} className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 my-1.5">
        {formatInline(trimmed)}
      </p>
    );
  });

  flushList(lines.length);
  return parsedNodes;
}

export function UpdateAvailableDialog({
  open,
  onOpenChange,
  updateInfo,
}: UpdateAvailableDialogProps) {
  const { t } = useTranslation("settings");

  if (!updateInfo) return null;

  const handleDownload = async () => {
    if (updateInfo.platformDownloadUrl) {
      await runtimeOpenUrl(updateInfo.platformDownloadUrl).catch(() => {});
    }
  };

  const handleOpenGitHub = async () => {
    if (updateInfo.githubReleaseUrl) {
      await runtimeOpenUrl(updateInfo.githubReleaseUrl).catch(() => {});
    }
  };

  const handleOpenSourceForge = async () => {
    if (updateInfo.sourceforgeUrl) {
      await runtimeOpenUrl(updateInfo.sourceforgeUrl).catch(() => {});
    }
  };

  // Clean title & optional subtitle
  let mainTitle = `TeleDrive v${updateInfo.latestVersion}`;
  let subTitle = "";
  if (updateInfo.releaseName) {
    const cleaned = updateInfo.releaseName.replace(/^[#🚀\s]+/, "").trim();
    if (cleaned.includes("—")) {
      const parts = cleaned.split("—");
      mainTitle = parts[0].trim();
      subTitle = parts.slice(1).join("—").trim();
    } else if (cleaned.includes(" - ")) {
      const parts = cleaned.split(" - ");
      mainTitle = parts[0].trim();
      subTitle = parts.slice(1).join(" - ").trim();
    } else if (
      cleaned.toLowerCase() !== mainTitle.toLowerCase() &&
      !cleaned.toLowerCase().startsWith(`v${updateInfo.latestVersion.toLowerCase()}`)
    ) {
      subTitle = cleaned;
    }
  }

  const formattedDate = React.useMemo(() => {
    if (!updateInfo.publishedAt) return null;
    try {
      const d = new Date(updateInfo.publishedAt);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return null;
    }
  }, [updateInfo.publishedAt]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-[560px] p-0 gap-0 rounded-3xl border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-[#0c0d12] shadow-2xl shadow-slate-900/15 dark:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] max-h-[88dvh] sm:max-h-[85vh] flex flex-col overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-200 ease-out"
      >
        {/* ── Top Header with App Logo, Version Pill & Close X ── */}
        <DialogHeader className="relative px-5 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-4.5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-b from-blue-500/[0.06] via-blue-500/[0.01] to-transparent shrink-0 text-left space-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3.5 min-w-0 flex-1">
              {/* App logo with badge */}
              <div className="relative shrink-0 mt-0.5">
                <div className="h-12 w-12 rounded-2xl bg-slate-100 dark:bg-[#151720] border border-slate-200/80 dark:border-white/10 p-1.5 flex items-center justify-center shadow-xs">
                  <img
                    src="/teledrive.png"
                    alt="TeleDrive"
                    className="h-full w-full object-contain rounded-xl"
                  />
                </div>
                <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#0B57D0] dark:bg-blue-600 flex items-center justify-center ring-2 ring-white dark:ring-[#0c0d12] shadow-xs">
                  <ArrowUpCircle className="h-3.5 w-3.5 text-white stroke-[2.2]" />
                </div>
              </div>

              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 bg-blue-500/10 dark:bg-blue-400/15 text-[#0B57D0] dark:text-[#8ab4f8] border border-blue-500/20 dark:border-blue-400/25 font-mono text-[11px] px-2.5 py-0.5 rounded-full font-semibold tracking-wide shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                    <span>v{updateInfo.currentVersion} → v{updateInfo.latestVersion}</span>
                  </span>

                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-400/15 border border-emerald-500/20 dark:border-emerald-400/25 px-2 py-0.5 rounded-full">
                    {t("about.updateDialog.readyBadge", "Update Available")}
                  </span>

                  {formattedDate && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                      {formattedDate}
                    </span>
                  )}
                </div>

                <DialogTitle className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white leading-snug">
                  {mainTitle}
                </DialogTitle>

                <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-snug line-clamp-2">
                  {subTitle || t("about.updateDialog.description", "A newer version of TeleDrive is ready to download.")}
                </DialogDescription>
              </div>
            </div>

            {/* Close button */}
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0 -mr-1 -mt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>
        </DialogHeader>

        {/* ── Formatted Release Notes ── */}
        <div className="px-5 py-4 sm:px-6 sm:py-4.5 flex-1 overflow-hidden flex flex-col select-text">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 flex items-center gap-1.5 shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#8ab4f8]" />
            <span>{t("about.updateDialog.releaseNotesTitle", "What's in this version")}</span>
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/80 dark:bg-white/[0.025] border border-slate-200/70 dark:border-white/[0.05] overflow-y-auto max-h-[280px] sm:max-h-[320px] custom-scrollbar">
            {renderReleaseNotes(updateInfo.releaseNotes) || (
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t(
                  "about.updateDialog.description",
                  "A newer version of TeleDrive is ready to download with new features, performance improvements, and fixes."
                )}
              </p>
            )}
          </div>
        </div>

        {/* ── Footer Actions ── */}
        <DialogFooter className="px-5 py-3.5 sm:px-6 sm:py-4 border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.01] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer w-full sm:w-auto h-9 font-medium"
          >
            {t("about.updateDialog.later", "Remind me later")}
          </Button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenGitHub}
              className="h-9 px-3 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer"
              title="View on GitHub Releases"
            >
              <GithubIcon />
              <span>GitHub</span>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenSourceForge}
              className="h-9 px-3 rounded-xl text-xs gap-1.5 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-700 dark:text-slate-200 cursor-pointer"
              title="View on SourceForge"
            >
              <span className="h-2 w-2 rounded-full bg-[#EE5B2B] shrink-0" />
              <span>SourceForge</span>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </Button>

            <Button
              type="button"
              onClick={handleDownload}
              className="h-9 px-4.5 rounded-xl text-xs sm:text-[13px] font-semibold gap-2 bg-[#0B57D0] hover:bg-[#0842a0] dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-sm hover:shadow-md transition-all active:scale-98 cursor-pointer border border-blue-400/20"
            >
              <Download className="h-4 w-4" />
              <span>{t("about.updateDialog.downloadPlatform", { platform: updateInfo.platformName, defaultValue: `Download ${updateInfo.platformName}` })}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
