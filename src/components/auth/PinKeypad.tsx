import { useEffect, useCallback } from "react";
import { Delete, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface PinKeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onSubmit?: () => void;
  disabled?: boolean;
}

const KEYS = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
];

export function PinKeypad({
  onDigit,
  onBackspace,
  onSubmit,
  disabled = false,
}: PinKeypadProps) {
  // Listen to physical keyboard typing
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        onDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        onBackspace();
      } else if (e.key === "Enter" && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    },
    [disabled, onDigit, onBackspace, onSubmit]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4 max-w-[280px] sm:max-w-[320px] mx-auto select-none">
      {KEYS.map(({ digit, letters }) => (
        <button
          key={digit}
          type="button"
          disabled={disabled}
          onClick={() => onDigit(digit)}
          aria-label={`Digit ${digit}`}
          className={cn(
            "h-16 w-16 sm:h-20 sm:w-20 mx-auto rounded-full flex flex-col items-center justify-center cursor-pointer",
            "border border-slate-200/80 dark:border-white/[0.08]",
            "bg-white/80 dark:bg-white/[0.04] backdrop-blur-md",
            "text-slate-900 dark:text-white shadow-xs",
            "hover:bg-[#f0f4f9] dark:hover:bg-white/[0.1] hover:border-slate-300 dark:hover:border-white/[0.15]",
            "active:scale-92 active:bg-[#e2e8f0] dark:active:bg-white/[0.18]",
            "transition-all duration-150 ease-out",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
          )}
        >
          <span className="text-2xl sm:text-3xl font-medium tracking-tight leading-none">
            {digit}
          </span>
          {letters && (
            <span className="text-[9px] sm:text-[10px] font-semibold tracking-wider text-slate-400 dark:text-slate-500 mt-0.5 leading-none">
              {letters}
            </span>
          )}
        </button>
      ))}

      {/* Backspace button */}
      <button
        type="button"
        disabled={disabled}
        onClick={onBackspace}
        aria-label="Backspace"
        className={cn(
          "h-16 w-16 sm:h-20 sm:w-20 mx-auto rounded-full flex items-center justify-center cursor-pointer",
          "text-slate-500 dark:text-slate-400",
          "hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-white/[0.06]",
          "active:scale-92 transition-all duration-150 ease-out",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
        )}
      >
        <Delete className="h-6 w-6 sm:h-7 sm:w-7" />
      </button>

      {/* 0 button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDigit("0")}
        aria-label="Digit 0"
        className={cn(
          "h-16 w-16 sm:h-20 sm:w-20 mx-auto rounded-full flex flex-col items-center justify-center cursor-pointer",
          "border border-slate-200/80 dark:border-white/[0.08]",
          "bg-white/80 dark:bg-white/[0.04] backdrop-blur-md",
          "text-slate-900 dark:text-white shadow-xs",
          "hover:bg-[#f0f4f9] dark:hover:bg-white/[0.1] hover:border-slate-300 dark:hover:border-white/[0.15]",
          "active:scale-92 active:bg-[#e2e8f0] dark:active:bg-white/[0.18]",
          "transition-all duration-150 ease-out",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
        )}
      >
        <span className="text-2xl sm:text-3xl font-medium tracking-tight leading-none">
          0
        </span>
      </button>

      {/* Submit / Enter button */}
      <button
        type="button"
        disabled={disabled}
        onClick={onSubmit}
        aria-label="Unlock"
        className={cn(
          "h-16 w-16 sm:h-20 sm:w-20 mx-auto rounded-full flex items-center justify-center cursor-pointer",
          "text-[#0B57D0] dark:text-[#8ab4f8]",
          "hover:bg-[#0B57D0]/10 dark:hover:bg-[#8ab4f8]/10",
          "active:scale-92 transition-all duration-150 ease-out",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
        )}
      >
        <Check className="h-6 w-6 sm:h-7 sm:w-7" />
      </button>
    </div>
  );
}
