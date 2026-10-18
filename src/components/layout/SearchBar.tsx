import React, { useState, useDeferredValue } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useFileStore } from "@/stores/fileStore";
import { fuzzySearch } from "@/lib/search/searchEngine";
import { FileIcon } from "../files/FileIcon";
import { TeleFile } from "@/lib/types";

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation("drive");
  
  const files = useFileStore((state) => state.files);

  // Defer the expensive fuzzy-search computation so the input stays responsive
  const deferredQuery = useDeferredValue(query);

  // Get top 5 fuzzy match quick results for non-trashed files
  const quickResults = deferredQuery.trim()
    ? fuzzySearch(files.filter((f) => !f.trashed), deferredQuery).slice(0, 5)
    : [];

  // Whether search results are stale (input faster than search)
  const isStale = deferredQuery !== query;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/drive/search?q=${encodeURIComponent(query.trim())}`);
      setIsFocused(false);
    }
  };

  const handleClear = () => {
    setQuery("");
  };

  const handleQuickResultClick = (file: TeleFile) => {
    setQuery("");
    setIsFocused(false);
    
    const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
    if (isDir) {
      // Navigate to the virtual folder
      navigate(`/drive/folder${file.folderPath === "/" ? "" : file.folderPath}/${file.name}`);
    } else {
      // Trigger global preview event
      const event = new CustomEvent("teledrive-preview-file", { detail: file });
      window.dispatchEvent(event);
    }
  };

  return (
    <div className="relative w-full">
      <form
        onSubmit={handleSubmit}
        className={`relative flex items-center w-full h-11 md:h-12 transition-all duration-200 rounded-full px-4.5 border ${
          isFocused
            ? "bg-white dark:bg-[#1e1f20] border-transparent shadow-[0_1px_3px_0_rgba(60,64,67,0.3),0_4px_8px_3px_rgba(60,64,67,0.15)] dark:shadow-[0_1px_3px_0_rgba(0,0,0,0.5)] ring-1 ring-black/5 dark:ring-white/10"
            : "bg-[#edf2fc] hover:bg-[#e1e8f5] dark:bg-[#282a2c] dark:hover:bg-[#333537] border-transparent shadow-xs"
        }`}
      >
        <Search className="h-5 w-5 text-[#444746] dark:text-[#c4c7c5] mr-3 shrink-0" />
        
        <input
          id="main-search-input"
          type="text"
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)} // short delay to allow clicks to register
          className="w-full h-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 px-0 text-sm text-[#1f1f1f] dark:text-[#e3e3e3] placeholder:text-[#444746] dark:placeholder:text-[#c4c7c5]"
        />

        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="h-7 w-7 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#444746] hover:text-[#1f1f1f] dark:text-[#c4c7c5] dark:hover:text-[#e3e3e3] shrink-0 ml-1 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </form>

      {/* Inline Quick Search Results Suggestion Dropdown */}
      {isFocused && query.trim() !== "" && (
        <div className={`absolute left-0 right-0 top-full mt-2 bg-white dark:bg-[#282a2c] border border-slate-200/80 dark:border-slate-800 shadow-2xl rounded-2xl overflow-hidden z-50 animate-fade-in py-1.5 transition-opacity duration-150 ${isStale ? "opacity-60" : "opacity-100"}`}>
          {quickResults.length > 0 ? (
            <div>
              <div className="px-4 py-2 text-[11px] font-semibold text-[#444746] dark:text-[#c4c7c5] uppercase tracking-wider">
                {t("search.matchingHeader")}
              </div>
              {quickResults.map((file) => {
                const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
                return (
                  <div
                    key={file.id}
                    onMouseDown={(e) => e.preventDefault()} // prevent input blur from unmounting suggestions prematurely
                    onClick={() => handleQuickResultClick(file)}
                    onDoubleClick={() => handleQuickResultClick(file)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f0f4f9] dark:hover:bg-[#333537] cursor-pointer transition-colors"
                  >
                    <FileIcon name={file.name} mime={file.mime} size="sm" className="p-0.5 rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[#1f1f1f] dark:text-[#e3e3e3] truncate">
                        {file.name}
                      </div>
                      <div className="text-[10px] text-[#444746] dark:text-[#c4c7c5] truncate">
                        {isDir ? t("search.folder") : t("search.fileIn", { location: file.folderPath === "/" ? t("nav.myDrive") : file.folderPath })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-4 text-xs text-center text-[#444746] dark:text-[#c4c7c5] font-medium">
              {t("search.noResults")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
