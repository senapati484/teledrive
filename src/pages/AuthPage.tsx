import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  ArrowLeft,
  MessageSquare,
  Lock,
  Languages,
  Check,
  QrCode,
  Smartphone,
  Mail,
  Send,
  Clock,
  Info,
  ExternalLink,
  Copy,
  PhoneCall,
  RefreshCw,
} from "lucide-react";
import { Api, TelegramClient } from "telegram";
import { useAuthStore } from "@/stores/authStore";
import { initClient, getClient, disconnectClient } from "@/lib/telegram/client";
import {
  saveSecret,
  getSecret,
  VAULT_KEY_SESSION,
  VAULT_KEY_PHONE,
  VAULT_KEY_API_ID,
  VAULT_KEY_API_HASH,
} from "@/lib/secure/vault";
import { bootstrapTeleDrive } from "@/lib/telegram/bootstrap";
import { APP_VERSION, DEFAULT_API_ID, DEFAULT_API_HASH } from "@/lib/telegram/config";
import { safeComputeCheck } from "@/lib/telegram/srp-helper";
import { startQrLogin } from "@/lib/telegram/qr-helper";
import { saveFutureAuthToken, loadLogoutTokens } from "@/lib/telegram/futureAuth";
import {
  PendingLogin,
  PENDING_CODE_TTL_MS,
  LoginDelivery,
  authErrorText,
  buildDiagnostics,
  checkCodeRequestBudget,
  classifyAuthError,
  getErrorCode,
  getMigrateDc,
  isAuthorizationSignUpRequired,
  isEmailVerifiedLogin,
  isPendingUsable,
  isSentCodeSuccess,
  maskEmail,
  maskPhone,
  parseSentCode,
  pendingFromSentCode,
  remainingSeconds,
} from "@/lib/telegram/loginFlow";
import {
  clearPendingLogin,
  loadFloodUntil,
  loadPendingLogin,
  loadRequestTimes,
  recordCodeRequest,
  saveFloodUntil,
  savePendingLogin,
} from "@/lib/telegram/loginStorage";
import { getPlatform } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

type Step = "phone" | "qr" | "otp" | "password" | "email" | "bootstrap";
type EmailStage = "address" | "code";

const DEFAULT_CODE_LENGTH = 5;

function sanitizePhone(raw: string): string {
  let clean = raw.trim().replace(/[^\d+]/g, "");
  if (clean.startsWith("00")) {
    clean = `+${clean.slice(2)}`;
  }
  if (clean.startsWith("+")) {
    return clean;
  }
  if (clean.startsWith("0") && clean.length === 11) {
    clean = clean.slice(1);
  }
  if (clean.length === 10 && /^[6-9]/.test(clean)) {
    return `+91${clean}`;
  }
  if (clean.length === 12 && clean.startsWith("91")) {
    return `+${clean}`;
  }
  return `+${clean}`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

function ResendFooter({
  floodUntil,
  resendAt,
  nextDelivery,
  resending,
  loading,
  onResend,
}: {
  floodUntil: number;
  resendAt: number;
  nextDelivery: LoginDelivery | null;
  resending: boolean;
  loading: boolean;
  onResend: () => void;
}) {
  const { t } = useTranslation("auth");
  const [now, setNow] = useState(() => Date.now());
  const floodRemaining = remainingSeconds(floodUntil, now);
  const resendRemaining = remainingSeconds(resendAt, now);
  const needsTick =
    floodRemaining > 0 || (!!nextDelivery && resendRemaining > 0);

  useEffect(() => {
    if (!needsTick) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [needsTick, floodUntil, resendAt]);

  const nextDeliveryKey =
    nextDelivery === "sms"
      ? "otp.resend.viaSms"
      : nextDelivery === "call"
      ? "otp.resend.viaCall"
      : nextDelivery === "fragment"
      ? "otp.resend.viaFragment"
      : "otp.resend.button";

  return (
    <div className="flex items-center justify-between px-1 text-[11px] min-h-[16px]">
      {floodRemaining > 0 ? (
        <div className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
          <Clock className="h-3 w-3" />
          <span>
            {t("otp.floodWait", { seconds: formatDuration(floodRemaining) })}
          </span>
        </div>
      ) : nextDelivery ? (
        resendRemaining > 0 ? (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              {t("otp.resend.wait", {
                seconds: formatDuration(resendRemaining),
              })}
            </span>
          </div>
        ) : (
          <button
            type="button"
            disabled={resending || loading}
            onClick={onResend}
            className="flex items-center gap-1 font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer transition-colors disabled:opacity-50"
          >
            {resending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t("otp.resend.sending")}</span>
              </>
            ) : (
              <span>{t(nextDeliveryKey)}</span>
            )}
          </button>
        )
      ) : (
        <span className="text-muted-foreground">
          {t("otp.resend.notAvailable")}
        </span>
      )}
    </div>
  );
}

function StepDots({ current }: { current: Step }) {
  const visibleSteps: Step[] = ["phone", "otp", "password"];
  const stepToMap =
    current === "qr" ? "phone" : current === "email" ? "otp" : current;
  const currentIndex = visibleSteps.indexOf(stepToMap as Step);
  if (currentIndex === -1) return null;
  return (
    <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
      {visibleSteps.map((s, i) => (
        <div
          key={s}
          className={cn(
            "transition-all duration-300 ease-out rounded-full",
            i === currentIndex
              ? "w-4.5 h-1 bg-[#0B57D0] dark:bg-[#A8C7FA]"
              : i < currentIndex
              ? "w-1.5 h-1 bg-[#0B57D0]/60 dark:bg-[#A8C7FA]/60"
              : "w-1.5 h-1 bg-slate-200 dark:bg-white/15"
          )}
        />
      ))}
    </div>
  );
}

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
  suffix?: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

function FormInput({
  label,
  id,
  suffix,
  inputRef,
  className,
  placeholder,
  ...props
}: FormInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="w-full text-left space-y-1.5">
      <label
        htmlFor={id}
        className={cn(
          "block text-xs font-semibold tracking-tight transition-colors duration-150 select-none",
          focused
            ? "text-[#0B57D0] dark:text-[#A8C7FA]"
            : "text-foreground/80 dark:text-foreground/70"
        )}
      >
        {label}
      </label>
      <div className="relative flex items-center w-full">
        <Input
          ref={inputRef as any}
          id={id}
          placeholder={placeholder}
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          className={cn(
            "h-11 sm:h-11.5 px-3.5 rounded-xl text-base sm:text-sm font-normal",
            "border transition-all duration-200 outline-none",
            "bg-white dark:bg-[#18191B]",
            "text-[#1f1f1f] dark:text-[#E3E3E3]",
            "placeholder:text-muted-foreground/45 dark:placeholder:text-muted-foreground/40",
            focused
              ? "border-[#0B57D0] dark:border-[#A8C7FA] ring-2 ring-[#0B57D0]/12 dark:ring-[#A8C7FA]/15"
              : "border-slate-200 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.14]",
            props.disabled ? "opacity-60 cursor-not-allowed" : "cursor-text",
            "focus-visible:ring-0 focus-visible:border-[#0B57D0] dark:focus-visible:border-[#A8C7FA]",
            suffix ? "pr-10" : "pr-3.5",
            className
          )}
        />
        {suffix && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center text-muted-foreground">
            {suffix}
          </div>
        )}
      </div>
    </div>
  );
}

const FloatingInput = FormInput;

interface OtpBoxProps {
  value: string;
  onChange: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  disabled: boolean;
  index: number;
  isFilled: boolean;
  totalDigits: number;
}

function OtpBox({
  value,
  onChange,
  onKeyDown,
  onPaste,
  inputRef,
  disabled,
  index,
  isFilled,
  totalDigits,
}: OtpBoxProps) {
  const { t } = useTranslation("auth");
  const [focused, setFocused] = useState(false);

  return (
    <div
      className="relative transition-all duration-150"
      style={{ transform: isFilled ? "scale(1.02)" : "scale(1)" }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={1}
        autoComplete={index === 0 ? "one-time-code" : "off"}
        enterKeyHint={index === totalDigits - 1 ? "done" : "next"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        aria-label={t("otp.digit", { number: index + 1 })}
        className={`
          ${totalDigits >= 6 ? "w-8.5 h-10.5 sm:w-10 sm:h-11.5 text-base sm:text-lg" : "w-9.5 h-11 sm:w-11 sm:h-12 text-lg sm:text-xl"}
          text-center font-bold rounded-xl
          border transition-all duration-200 outline-none
          bg-white dark:bg-[#18191B]
          text-[#1f1f1f] dark:text-[#E3E3E3]
          ${focused
            ? "border-[#0B57D0] dark:border-[#A8C7FA] shadow-[0_0_0_3px_rgba(11,87,208,0.12)]"
            : isFilled
            ? "border-[#1e8e3e] dark:border-[#81c995] bg-[#f0fdf4] dark:bg-[#1a2f1a]"
            : "border-slate-200 dark:border-white/[0.08]"}
          ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-text"}
          caret-transparent
        `}
      />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="w-full flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/[0.08] dark:bg-rose-500/[0.12] text-rose-700 dark:text-rose-300 text-xs animate-in fade-in duration-200 text-left">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-500 dark:text-rose-400" />
      <span className="leading-tight font-medium text-[11px]">{message}</span>
    </div>
  );
}

function PrimaryButton({
  loading,
  loadingLabel,
  label,
  disabled,
  type = "submit",
  onClick,
}: {
  loading: boolean;
  loadingLabel: string;
  label: string;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <Button
      type={type}
      disabled={disabled ?? loading}
      onClick={onClick}
      className={`
        w-full h-10 sm:h-11 rounded-full text-xs sm:text-sm font-medium
        bg-[#0B57D0] hover:bg-[#0842A0] active:bg-[#063177]
        dark:bg-[#A8C7FA] dark:hover:bg-[#c2d8fb] dark:active:bg-[#d3e3fd]
        dark:text-[#062E6F]
        text-white shadow-xs
        transition-all duration-200
        cursor-pointer
        disabled:opacity-60 disabled:cursor-not-allowed
        relative overflow-hidden
      `}
    >
      <span
        className={`flex items-center justify-center gap-2 transition-all duration-200 ${
          loading ? "opacity-0" : "opacity-100"
        }`}
      >
        {label}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="ml-2 text-xs">{loadingLabel}</span>
        </span>
      )}
    </Button>
  );
}

function BackButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className="w-full h-9 rounded-full hover:bg-slate-100 dark:hover:bg-white/[0.05] flex gap-1.5 justify-center items-center text-xs font-medium text-[#0B57D0] dark:text-[#A8C7FA] transition-all duration-200 cursor-pointer"
    >
      <ArrowLeft className="h-3 w-3" />
      {label}
    </Button>
  );
}

export default function AuthPage() {
  const { t, i18n } = useTranslation(["auth", "common"]);
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  const [configApiId, setConfigApiId] = useState<number | null>(null);
  const [configApiHash, setConfigApiHash] = useState<string | null>(null);
  const [checkingConfig, setCheckingConfig] = useState(true);

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const pendingRef = useRef<PendingLogin | null>(null);
  const [otp, setOtp] = useState<string[]>(
    Array.from({ length: DEFAULT_CODE_LENGTH }, () => "")
  );
  const [resendAt, setResendAt] = useState(0);
  const [floodUntil, setFloodUntil] = useState(0);
  const [lastError, setLastError] = useState<ReturnType<
    typeof classifyAuthError
  > | null>(null);

  const [emailStage, setEmailStage] = useState<EmailStage>("address");
  const [emailAddress, setEmailAddress] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeLength, setEmailCodeLength] = useState(5);
  const [emailPattern, setEmailPattern] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState(() =>
    t("bootstrap.connecting")
  );
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrTgUrl, setQrTgUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [openingTelegram, setOpeningTelegram] = useState(false);
  const qrCleanupRef = useRef<(() => void) | null>(null);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const sendInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);
  const passwordInFlightRef = useRef(false);
  const emailInFlightRef = useRef(false);
  const autoSubmitTimerRef = useRef<number | null>(null);
  const resendingGuard = useRef(false);

  const codeLength =
    pending && pending.codeLength > 0 ? pending.codeLength : DEFAULT_CODE_LENGTH;
  const deliveryType: LoginDelivery = pending?.delivery ?? "unknown";
  const nextDelivery: LoginDelivery | null = pending?.nextDelivery ?? null;

  useEffect(() => {
    async function loadConfig() {
      try {
        const id = await getSecret(VAULT_KEY_API_ID);
        const hash = await getSecret(VAULT_KEY_API_HASH);
        const parsedId = id ? parseInt(id, 10) : NaN;
        setConfigApiId(
          Number.isFinite(parsedId) && parsedId > 0
            ? parsedId
            : DEFAULT_API_ID
        );
        setConfigApiHash(hash || DEFAULT_API_HASH);
      } catch {
        setConfigApiId(DEFAULT_API_ID);
        setConfigApiHash(DEFAULT_API_HASH);
      } finally {
        setCheckingConfig(false);
      }
    }
    loadConfig();
  }, []);

  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  useEffect(() => {
    return () => {
      if (autoSubmitTimerRef.current) {
        window.clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
    };
  }, []);

  const applyPending = useCallback((next: PendingLogin | null) => {
    pendingRef.current = next;
    setPending(next);
    if (next) {
      setResendAt(next.resendAt);
      setFloodUntil(next.floodUntil);
      void savePendingLogin(next);
    } else {
      setResendAt(0);
      setFloodUntil(0);
      void clearPendingLogin();
    }
  }, []);

  const persistPending = useCallback((next: PendingLogin) => {
    pendingRef.current = next;
    setPending(next);
    void savePendingLogin(next);
  }, []);

  const applySentCode = useCallback(
    (info: ReturnType<typeof parseSentCode>, phoneValue: string, tempSession: string) => {
      if (!info) return;
      const p = pendingFromSentCode(phoneValue, info, tempSession);
      applyPending(p);
      const length = info.codeLength > 0 ? info.codeLength : DEFAULT_CODE_LENGTH;
      setOtp(Array.from({ length }, () => ""));
      setEmailPattern(info.emailPattern || "");
      setEmailCode("");
      setEmailStage("address");
      setError(null);
      setLastError(null);
      saveFloodUntil(phoneValue, 0);

      if (info.delivery === "emailSetup") {
        setStep("email");
        toast.info(t("toasts.emailSetupRequired"));
      } else {
        setStep("otp");
        if (info.delivery === "app") toast.success(t("toasts.codeSentApp"));
        else if (info.delivery === "sms") toast.success(t("toasts.codeSentSms"));
        else if (info.delivery === "email") toast.success(t("toasts.codeSentEmail"));
        else toast.success(t("toasts.codeSent"));
      }
    },
    [applyPending, t]
  );

  const showError = useCallback(
    (err: any) => {
      const info = classifyAuthError(err);
      setLastError(info);
      setError(authErrorText(info, t));
      if (info.floodSeconds) {
        const until = Date.now() + info.floodSeconds * 1000;
        setFloodUntil(until);
        const stored = pendingRef.current;
        const forPhone = stored?.phone || sanitizePhone(phone);
        if (forPhone) saveFloodUntil(forPhone, until);
        if (stored) persistPending({ ...stored, floodUntil: until });
      }
      return info;
    },
    [persistPending, phone, t]
  );

  const completeAuthentication = useCallback(
    async (client: TelegramClient, authorization?: any) => {
      if (authorization?.futureAuthToken) {
        await saveFutureAuthToken(authorization.futureAuthToken);
      }

      const sessionString = client.session.save() as unknown as string;
      let authPhone =
        pendingRef.current?.phone || (phone.trim() ? sanitizePhone(phone) : "");

      // auth.Authorization already carries the user, so QR/2FA logins usually
      // avoid an extra getMe round-trip.
      const userPhone = authorization?.user?.phone;
      if (!authPhone && typeof userPhone === "string" && userPhone.trim()) {
        const trimmed = userPhone.trim();
        authPhone = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
      }

      if (!authPhone) {
        try {
          const me: any = await client.getMe();
          if (me?.phone) authPhone = `+${me.phone}`;
        } catch (meErr) {
          console.warn("Could not retrieve profile phone:", meErr);
        }
      }

      try {
        await invoke("save_session", { session: sessionString, phone: authPhone });
      } catch (saveErr) {
        console.error("save_session (Rust) failed:", saveErr);
      }

      try {
        await saveSecret(VAULT_KEY_SESSION, sessionString);
        await saveSecret(VAULT_KEY_PHONE, authPhone);
      } catch (vaultErr) {
        console.warn("Stronghold saveSecret failed (non-fatal):", vaultErr);
      }

      applyPending(null);
      setStep("bootstrap");
      try {
        await bootstrapTeleDrive(
          (status) => {
            setBootstrapStatus(status);
          },
          authPhone
        );
        toast.success(t("toasts.ready"));
        setSession(sessionString, authPhone);
        navigate("/drive/my-drive");
      } catch (err: any) {
        console.error("Bootstrap failed:", err);
        setBootstrapError(err.message || t("errors.bootstrapFailed"));
      }
    },
    [applyPending, navigate, phone, setSession, t]
  );

  useEffect(() => {
    if (checkingConfig || !configApiId || !configApiHash) return;
    let active = true;

    (async () => {
      const stored = await loadPendingLogin();
      if (!active || !stored) return;

      setPhone(stored.phone);
      if (Date.now() >= stored.expiresAt) {
        await clearPendingLogin();
        return;
      }

      pendingRef.current = stored;
      setPending(stored);
      setResendAt(stored.resendAt);
      setFloodUntil(Math.max(stored.floodUntil, loadFloodUntil(stored.phone)));
      setEmailPattern(stored.emailPattern || "");
      const length =
        stored.codeLength > 0 ? stored.codeLength : DEFAULT_CODE_LENGTH;
      setOtp(Array.from({ length }, () => ""));

      if (stored.tempSession) {
        try {
          await initClient(configApiId, configApiHash, stored.tempSession);
        } catch (err) {
          console.warn("Could not restore pending Telegram auth key:", err);
        }
      }

      if (stored.requiresPassword) {
        setStep("password");
      } else if (stored.delivery === "emailSetup") {
        setStep("email");
        setEmailStage("address");
      } else {
        setStep("otp");
      }
    })();

    return () => {
      active = false;
    };
  }, [checkingConfig, configApiId, configApiHash]);

  useEffect(() => {
    if (step !== "qr") {
      if (qrCleanupRef.current) {
        qrCleanupRef.current();
        qrCleanupRef.current = null;
      }
      setQrDataUrl(null);
      setQrTgUrl(null);
      return;
    }

    if (!configApiId || !configApiHash) return;

    let isSubscribed = true;
    setQrLoading(true);
    setError(null);

    (async () => {
      try {
        await initClient(configApiId, configApiHash);
        const client = getClient();
        if (!isSubscribed) return;

        const cleanup = startQrLogin(client, configApiId, configApiHash, {
          onQrUrl: (url, _expires, tgUrl) => {
            if (isSubscribed) {
              setQrDataUrl(url);
              if (tgUrl) setQrTgUrl(tgUrl);
              setQrLoading(false);
              setError(null);
              setLastError(null);
            }
          },
          onSuccess: (authorization) => {
            if (isSubscribed) {
              void completeAuthentication(client, authorization).catch((err) =>
                showError(err)
              );
            }
          },
          onPasswordNeeded: () => {
            if (isSubscribed) {
              setStep("password");
            }
          },
          onError: (err) => {
            if (isSubscribed) {
              console.error("QR Login error:", err);
              showError(err);
              setQrLoading(false);
            }
          },
        });

        if (cleanup && typeof cleanup === "function") {
          qrCleanupRef.current = cleanup;
        }
      } catch (err: any) {
        if (isSubscribed) {
          console.error("QR setup error:", err);
          showError(err);
          setQrLoading(false);
        }
      }
    })();

    return () => {
      isSubscribed = false;
      if (qrCleanupRef.current) {
        qrCleanupRef.current();
        qrCleanupRef.current = null;
      }
    };
  }, [step, configApiId, configApiHash, completeAuthentication, showError]);

  const handleOpenTelegram = useCallback(
    async (url: string, oneTap = false) => {
      if (!url) return;
      setOpeningTelegram(true);
      const toastMessage = oneTap
        ? t("qr.openedOneTapToast")
        : t("otp.delivery.openAppToast");

      try {
        try {
          await invoke("open_telegram_app", { url });
          toast.info(toastMessage);
          return;
        } catch (nativeErr) {
          console.warn(
            "Native open_telegram_app failed, trying openUrl:",
            nativeErr
          );
        }

        try {
          await openUrl(url);
          toast.info(toastMessage);
          return;
        } catch (openerErr) {
          console.warn("openUrl failed for Telegram URL:", openerErr);
        }

        const isAndroid =
          typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
        if (isAndroid && url.startsWith("tg://login?token=")) {
          const token = url.replace(/^tg:\/\/login\?token=/, "");
          window.location.href = `intent://login?token=${token}#Intent;scheme=tg;package=org.telegram.messenger;end`;
        } else {
          window.location.href = url;
        }
        toast.info(toastMessage);
      } catch (err) {
        console.error("Failed to open Telegram:", err);
        toast.error(t("qr.openAppError"));
      } finally {
        setTimeout(() => setOpeningTelegram(false), 1500);
      }
    },
    [t]
  );

  const openQrStep = () => {
    if (step === "qr") return;
    applyPending(null);
    void disconnectClient();
    setPhone("");
    setOtp([]);
    setPassword("");
    setLastError(null);
    setStep("qr");
    setError(null);
  };

  const ensureClient = async (): Promise<TelegramClient> => {
    if (!configApiId || !configApiHash) {
      throw new Error("Telegram API credentials missing.");
    }
    const stored = pendingRef.current;
    await initClient(
      configApiId,
      configApiHash,
      stored?.tempSession ?? ""
    );
    const client = getClient();
    if (!client.connected) await client.connect();
    return client;
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendInFlightRef.current) return;

    const formattedPhone = sanitizePhone(phone);
    if (!phone.trim()) {
      setError(t("errors.phoneRequired"));
      return;
    }
    if (formattedPhone.length < 7 || !/^\+[0-9]{6,16}$/.test(formattedPhone)) {
      setError(t("errors.phoneNumberInvalid"));
      return;
    }
    if (!configApiId || !configApiHash) {
      setError(t("errors.apiCredentialsMissing"));
      return;
    }

    const existing = pendingRef.current;
    if (
      existing &&
      existing.phone === formattedPhone &&
      isPendingUsable(existing)
    ) {
      setError(null);
      setStep(
        existing.requiresPassword
          ? "password"
          : existing.delivery === "emailSetup"
          ? "email"
          : "otp"
      );
      return;
    }

    const now = Date.now();
    const savedFlood = loadFloodUntil(formattedPhone);
    if (savedFlood > now) {
      setFloodUntil(savedFlood);
      const seconds = remainingSeconds(savedFlood, now);
      setError(t("errors.floodWait", { count: seconds }));
      return;
    }

    const budget = checkCodeRequestBudget(
      loadRequestTimes(formattedPhone, now),
      now
    );
    if (!budget.allowed) {
      setLastError({
        code: "LOCAL_RATE_LIMIT",
        messageKey: "errors.tooManyCodeRequests",
        floodSeconds: budget.retryAfterSeconds,
        isNetwork: false,
        suggestQr: true,
      });
      setError(
        t("errors.tooManyCodeRequests", { count: budget.retryAfterSeconds })
      );
      return;
    }

    sendInFlightRef.current = true;
    setLoading(true);
    setError(null);
    setLastError(null);

    try {
      const [, logoutTokens] = await Promise.all([
        initClient(configApiId, configApiHash, "", true),
        loadLogoutTokens(),
      ]);
      const client = getClient();

      let result: any = null;
      let lastErr: any = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          result = await client.invoke(
            new Api.auth.SendCode({
              phoneNumber: formattedPhone,
              apiId: configApiId,
              apiHash: configApiHash,
              settings: new Api.CodeSettings({
                currentNumber: false,
                allowAppHash: false,
                allowMissedCall: true,
                logoutTokens: logoutTokens.length ? logoutTokens : undefined,
              }),
            })
          );
          break;
        } catch (err: any) {
          lastErr = err;
          if (attempt === 0) {
            if (getErrorCode(err) === "AUTH_RESTART") {
              await new Promise((r) => setTimeout(r, 900));
              continue;
            }
            const migrateDc = getMigrateDc(err);
            if (migrateDc) {
              await (client as any)._switchDC(migrateDc);
              continue;
            }
          }
          throw err;
        }
      }

      if (!result) throw lastErr ?? new Error(t("errors.sendCodeFailed"));

      if (isSentCodeSuccess(result)) {
        if (result.authorization?.futureAuthToken) {
          await saveFutureAuthToken(result.authorization.futureAuthToken);
        }
        await completeAuthentication(client, result.authorization);
        return;
      }

      const info = parseSentCode(result);
      if (!info) throw new Error(t("errors.sendCodeFailed"));
      recordCodeRequest(formattedPhone, Date.now());
      applySentCode(info, formattedPhone, client.session.save() as unknown as string);
    } catch (err: any) {
      if (getErrorCode(err) === "SESSION_PASSWORD_NEEDED") {
        const client = getClient();
        const nowMs = Date.now();
        const passwordPending: PendingLogin = {
          phone: formattedPhone,
          tempSession: client.session.save() as unknown as string,
          phoneCodeHash: "",
          delivery: "unknown",
          typeName: "",
          codeLength: 0,
          nextDelivery: null,
          nextTypeName: null,
          timeoutSeconds: 0,
          emailPattern: null,
          resetAvailablePeriod: null,
          resetPendingDate: null,
          fragmentUrl: null,
          sentAt: nowMs,
          resendAt: 0,
          expiresAt: nowMs + PENDING_CODE_TTL_MS,
          floodUntil: 0,
          requiresPassword: true,
        };
        applyPending(passwordPending);
        setStep("password");
        return;
      }

      console.error("Send code failed:", err);
      if (pendingRef.current) {
        applyPending(null);
      }
      showError(err);
    } finally {
      sendInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    const stored = pendingRef.current;
    if (resendingGuard.current || !stored) return;
    const now = Date.now();
    if (floodUntil > now || stored.resendAt > now) return;
    if (!stored.nextDelivery) return;

    const budget = checkCodeRequestBudget(
      loadRequestTimes(stored.phone, now),
      now
    );
    if (!budget.allowed) {
      setLastError({
        code: "LOCAL_RATE_LIMIT",
        messageKey: "errors.tooManyCodeRequests",
        floodSeconds: budget.retryAfterSeconds,
        isNetwork: false,
        suggestQr: true,
      });
      setError(
        t("errors.tooManyCodeRequests", { count: budget.retryAfterSeconds })
      );
      return;
    }

    resendingGuard.current = true;
    setResending(true);
    setError(null);
    setLastError(null);

    try {
      const client = await ensureClient();
      const resendResult: any = await client.invoke(
        new Api.auth.ResendCode({
          phoneNumber: stored.phone,
          phoneCodeHash: stored.phoneCodeHash,
        })
      );

      if (isSentCodeSuccess(resendResult)) {
        await completeAuthentication(client, resendResult.authorization);
        return;
      }

      const info = parseSentCode(resendResult);
      if (!info) throw new Error(t("errors.resendFailed"));
      recordCodeRequest(stored.phone, Date.now());
      applySentCode(info, stored.phone, stored.tempSession);
      toast.success(t("otp.resend.successToast"));
    } catch (err: any) {
      console.error("Resend code failed:", err);
      const info = classifyAuthError(err);
      if (info.code === "SEND_CODE_UNAVAILABLE") {
        const updated = { ...stored, nextDelivery: null, nextTypeName: null };
        persistPending(updated);
        toast.info(t("otp.resend.unavailableToast"));
      } else {
        showError(err);
        if (
          info.code === "PHONE_CODE_EXPIRED" ||
          info.code === "PHONE_HASH_EXPIRED" ||
          info.code === "AUTH_KEY_UNREGISTERED" ||
          info.code === "AUTH_KEY_INVALID" ||
          info.code === "AUTH_RESTART"
        ) {
          applyPending(null);
          setStep("phone");
        }
      }
    } finally {
      resendingGuard.current = false;
      setResending(false);
    }
  };

  const executeVerifyCode = async (codeToVerify: string) => {
    if (autoSubmitTimerRef.current) {
      window.clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    const stored = pendingRef.current;
    if (!stored || verifyInFlightRef.current) return;

    verifyInFlightRef.current = true;
    setLoading(true);
    setError(null);
    setLastError(null);

    try {
      const client = await ensureClient();
      const result: any = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: stored.phone,
          phoneCodeHash: stored.phoneCodeHash,
          phoneCode: codeToVerify,
        })
      );

      if (isAuthorizationSignUpRequired(result)) {
        applyPending(null);
        setStep("phone");
        setError(t("errors.signUpRequired"));
        return;
      }

      await completeAuthentication(client, result);
    } catch (err: any) {
      const code = getErrorCode(err);
      if (code === "SESSION_PASSWORD_NEEDED") {
        const updated = { ...stored, requiresPassword: true };
        persistPending(updated);
        setStep("password");
        return;
      }

      console.error("OTP verification failed:", err);
      const info = showError(err);

      if (
        code === "PHONE_CODE_EXPIRED" ||
        code === "PHONE_HASH_EXPIRED" ||
        code === "AUTH_KEY_UNREGISTERED" ||
        code === "AUTH_KEY_INVALID" ||
        code === "AUTH_RESTART"
      ) {
        applyPending(null);
        setStep("phone");
      } else if (code === "PHONE_CODE_INVALID" || code === "PHONE_CODE_EMPTY") {
        setOtp(Array.from({ length: codeLength }, () => ""));
        otpRefs.current[0]?.focus();
      }
      setLastError(info);
    } finally {
      verifyInFlightRef.current = false;
      setLoading(false);
    }
  };

  const scheduleVerify = (code: string, delayMs: number) => {
    if (autoSubmitTimerRef.current) {
      window.clearTimeout(autoSubmitTimerRef.current);
    }
    autoSubmitTimerRef.current = window.setTimeout(() => {
      autoSubmitTimerRef.current = null;
      void executeVerifyCode(code);
    }, delayMs);
  };

  const handleOtpChange = (index: number, val: string) => {
    if (autoSubmitTimerRef.current) {
      window.clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    const digits = val.replace(/[^0-9]/g, "");
    if (!digits) {
      const next = [...otp];
      next[index] = "";
      setOtp(next);
      return;
    }

    if (digits.length > 1) {
      const next = [...otp];
      for (let i = 0; i < digits.length && index + i < codeLength; i++) {
        next[index + i] = digits[i];
      }
      setOtp(next);
      const focusIndex = Math.min(index + digits.length, codeLength - 1);
      otpRefs.current[focusIndex]?.focus();
      if (!next.includes("")) {
        scheduleVerify(next.join(""), 50);
      }
      return;
    }

    const next = [...otp];
    next[index] = digits[0];
    setOtp(next);

    if (index < codeLength - 1) {
      otpRefs.current[index + 1]?.focus();
    }

    if (!next.includes("")) {
      scheduleVerify(next.join(""), 50);
    }
  };

  const handleOtpKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Backspace") {
      if (!otp[index] && index > 0) {
        otpRefs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      otpRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < codeLength - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (autoSubmitTimerRef.current) {
      window.clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    const rawDigits = e.clipboardData
      .getData("text")
      .replace(/[^0-9]/g, "")
      .slice(0, codeLength);
    if (!rawDigits) return;

    const newOtp = Array.from({ length: codeLength }, () => "");
    rawDigits.split("").forEach((d, i) => {
      newOtp[i] = d;
    });
    setOtp(newOtp);

    const focusIndex = Math.min(rawDigits.length, codeLength - 1);
    setTimeout(() => {
      otpRefs.current[focusIndex]?.focus();
    }, 0);

    if (rawDigits.length === codeLength) {
      scheduleVerify(rawDigits, 60);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== codeLength) {
      setError(t("errors.incompleteCode", { count: codeLength }));
      return;
    }
    await executeVerifyCode(code);
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || passwordInFlightRef.current) return;
    if (!password) {
      setError(t("errors.passwordRequired"));
      return;
    }

    passwordInFlightRef.current = true;
    setLoading(true);
    setError(null);
    setLastError(null);

    try {
      const client = await ensureClient();
      const pwdInfo = await client.invoke(new Api.account.GetPassword());
      const srpResult = await safeComputeCheck(pwdInfo as any, password);
      const passwordParam =
        srpResult instanceof Api.InputCheckPasswordSRP
          ? srpResult
          : new Api.InputCheckPasswordSRP({
              srpId: srpResult.srpId || (pwdInfo as any).srpId,
              A: srpResult.A,
              M1: srpResult.M1,
            });
      const result: any = await client.invoke(
        new Api.auth.CheckPassword({ password: passwordParam })
      );
      await completeAuthentication(client, result);
    } catch (err: any) {
      console.error("2FA password failed:", err);
      showError(err);
    } finally {
      passwordInFlightRef.current = false;
      setLoading(false);
    }
  };

  const buildEmailPurpose = () => {
    const stored = pendingRef.current;
    return new Api.EmailVerifyPurposeLoginSetup({
      phoneNumber: stored?.phone || sanitizePhone(phone),
      phoneCodeHash: stored?.phoneCodeHash || "",
    });
  };

  const handleSendVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailBusy || emailInFlightRef.current) return;
    const email = emailAddress.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t("errors.emailInvalid"));
      return;
    }

    emailInFlightRef.current = true;
    setEmailBusy(true);
    setError(null);
    setLastError(null);

    try {
      const client = await ensureClient();
      const result: any = await client.invoke(
        new Api.account.SendVerifyEmailCode({
          purpose: buildEmailPurpose(),
          email,
        })
      );
      setEmailPattern(result?.emailPattern || email);
      setEmailCodeLength(
        typeof result?.length === "number" && result.length > 0
          ? result.length
          : 5
      );
      setEmailCode("");
      setEmailStage("code");
      toast.success(t("emailSetup.codeSentToast"));
    } catch (err: any) {
      console.error("Send verify email code failed:", err);
      showError(err);
    } finally {
      emailInFlightRef.current = false;
      setEmailBusy(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailBusy || emailInFlightRef.current) return;
    const stored = pendingRef.current;
    if (!stored) return;
    if (emailCode.trim().length !== emailCodeLength) {
      setError(t("errors.incompleteCode", { count: emailCodeLength }));
      return;
    }

    emailInFlightRef.current = true;
    setEmailBusy(true);
    setError(null);
    setLastError(null);

    try {
      const client = await ensureClient();
      const result: any = await client.invoke(
        new Api.account.VerifyEmail({
          purpose: buildEmailPurpose(),
          verification: new Api.EmailVerificationCode({ code: emailCode.trim() }),
        })
      );

      if (isEmailVerifiedLogin(result) || result?.sentCode) {
        const info = parseSentCode(result.sentCode);
        if (!info) throw new Error(t("errors.sendCodeFailed"));
        const newEmail = result.email || emailPattern || emailAddress;
        setEmailPattern(newEmail);
        applySentCode(info, stored.phone, stored.tempSession);
      } else {
        throw new Error(t("errors.emailVerifyFailed"));
      }
    } catch (err: any) {
      console.error("Verify email failed:", err);
      showError(err);
    } finally {
      emailInFlightRef.current = false;
      setEmailBusy(false);
    }
  };

  const handleResetLoginEmail = async () => {
    const stored = pendingRef.current;
    if (!stored || !stored.phoneCodeHash || emailBusy || emailInFlightRef.current)
      return;

    emailInFlightRef.current = true;
    setEmailBusy(true);
    setError(null);
    setLastError(null);

    try {
      const client = await ensureClient();
      const result: any = await client.invoke(
        new Api.auth.ResetLoginEmail({
          phoneNumber: stored.phone,
          phoneCodeHash: stored.phoneCodeHash,
        })
      );
      const info = parseSentCode(result);
      if (!info) throw new Error(t("errors.resendFailed"));
      applySentCode(info, stored.phone, stored.tempSession);
    } catch (err: any) {
      console.error("Reset login email failed:", err);
      showError(err);
    } finally {
      emailInFlightRef.current = false;
      setEmailBusy(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    const stored = pendingRef.current;
    const text = buildDiagnostics({
      delivery: stored?.delivery ?? "unknown",
      nextDelivery: stored?.nextDelivery ?? null,
      timeoutSeconds: stored?.timeoutSeconds ?? 0,
      codeLength,
      phone: stored?.phone || sanitizePhone(phone),
      platform: getPlatform(),
      appVersion: APP_VERSION,
      errorCode: lastError?.code || null,
    });

    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("diagnostics.copied"));
    } catch {
      toast.info(text);
    }
  };

  if (checkingConfig) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background select-none">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="h-8 w-8 rounded-full border-2 border-slate-200 dark:border-white/10" />
            <Loader2 className="h-8 w-8 animate-spin text-[#0B57D0] dark:text-[#A8C7FA] absolute inset-0" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {t("loading")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-[100dvh] w-full overflow-hidden bg-background select-none flex flex-col justify-between items-center py-3 sm:py-6 px-4 relative">
      <div className="absolute top-[max(calc(var(--safe-area-top,0px)+0.75rem),1.5rem)] sm:top-4 right-4 sm:right-4 z-30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary/80 border border-border/40 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Languages className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
              <span>
                {SUPPORTED_LANGUAGES.find(
                  (l) => l.code === (i18n.resolvedLanguage || i18n.language)
                )?.label ?? "Lang"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-40 p-1 rounded-xl bg-popover border border-border/60 shadow-xl"
          >
            {SUPPORTED_LANGUAGES.map((lang) => {
              const currentLng = i18n.resolvedLanguage || i18n.language;
              const isSelected = currentLng === lang.code;
              return (
                <DropdownMenuItem
                  key={lang.code}
                  onClick={() => i18n.changeLanguage(lang.code)}
                  className={cn(
                    "flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg cursor-pointer transition-colors",
                    isSelected
                      ? "bg-[#C2E7FF]/40 dark:bg-[#004A77]/50 text-[#0B57D0] dark:text-[#A8C7FA] font-medium"
                      : "text-foreground hover:bg-muted/60"
                  )}
                >
                  <span>{lang.label}</span>
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="my-auto w-full max-w-[340px] sm:max-w-[380px] flex flex-col items-center justify-center z-10">
        <div className="flex flex-col items-center mb-3 sm:mb-4">
          <Link
            to="/drive/my-drive"
            className="inline-flex items-center gap-2.5 group"
          >
            <img
              src="/teledrive.png"
              alt="TeleDrive"
              className="h-8 w-8 sm:h-9 sm:w-9 object-contain transition-transform duration-200 group-hover:scale-105"
            />
            <span className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              TeleDrive
            </span>
          </Link>
        </div>

        <div className="w-full bg-white dark:bg-[#141517] rounded-2xl sm:rounded-3xl shadow-[0_4px_24px_rgba(0,0,0,0.05)] dark:shadow-[0_16px_44px_rgba(0,0,0,0.6)] p-4 sm:p-5 transition-all duration-300">
          {error && (
            <div className="mb-3">
              <ErrorBanner message={error} />
            </div>
          )}

          {(step === "phone" || step === "qr") && (
            <div className="space-y-3.5 animate-in fade-in duration-200">
              <div className="flex bg-[#F0F4F9] dark:bg-[#1E1F22] p-1 rounded-full">
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setError(null);
                  }}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-medium rounded-full transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                    step === "phone"
                      ? "bg-white dark:bg-[#2C2D30] text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  <span>{t("phone.tabPhone")}</span>
                </button>
                <button
                  type="button"
                  onClick={openQrStep}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-medium rounded-full transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                    step === "qr"
                      ? "bg-white dark:bg-[#2C2D30] text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{t("phone.tabQr")}</span>
                </button>
              </div>

              {step === "phone" && (
                <form onSubmit={handleSendCode} className="space-y-3.5" noValidate>
                  <div className="text-center space-y-0.5">
                    <h1 className="text-base sm:text-lg font-semibold text-foreground leading-tight">
                      {t("phone.title")}
                    </h1>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("phone.subtitle")}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <FloatingInput
                      id="phone-number"
                      label={t("phone.label")}
                      placeholder={t("phone.placeholder")}
                      type="tel"
                      inputMode="tel"
                      enterKeyHint="next"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        setError(null);
                      }}
                      disabled={loading}
                      autoComplete="tel"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.form?.requestSubmit();
                      }}
                    />
                    {phone.trim().length >= 5 && (
                      <div className="flex items-center gap-1.5 px-1 text-xs text-[#0B57D0] dark:text-[#A8C7FA] font-medium animate-in fade-in duration-150">
                        <span>{t("phone.willSendCode")}</span>
                        <span className="font-mono font-semibold">
                          {sanitizePhone(phone)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground leading-tight">
                      <Info className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5" />
                      <span>{t("phone.deliveryTip")}</span>
                    </div>
                  </div>

                  <PrimaryButton
                    loading={loading}
                    loadingLabel={t("phone.sending")}
                    label={t("phone.next")}
                    disabled={loading || !phone.trim()}
                  />

                  <p className="text-center text-[10px] text-muted-foreground/80 leading-relaxed pt-0.5">
                    <Trans
                      t={t}
                      i18nKey="phone.terms"
                      components={{
                        terms: (
                          <span className="text-[#0B57D0] dark:text-[#A8C7FA] cursor-pointer hover:underline" />
                        ),
                      }}
                    />
                  </p>
                </form>
              )}

              {step === "qr" && (
                <div className="space-y-3.5 text-center">
                  <div className="space-y-0.5">
                    <h1 className="text-base sm:text-lg font-semibold text-foreground leading-tight">
                      {t("qr.title")}
                    </h1>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("qr.subtitle")}
                    </p>
                  </div>

                  <div className="flex flex-col items-center py-0.5">
                    <div className="p-2.5 bg-white rounded-2xl shadow-xs border border-black/5 dark:border-white/10">
                      {qrLoading || !qrDataUrl ? (
                        <div className="w-[140px] h-[140px] sm:w-[150px] sm:h-[150px] flex flex-col items-center justify-center gap-2">
                          <Loader2 className="h-6 w-6 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {t("qr.refreshing")}
                          </span>
                        </div>
                      ) : (
                        <img
                          src={qrDataUrl}
                          alt="Telegram QR Login"
                          className="w-[140px] h-[140px] sm:w-[150px] sm:h-[150px] object-contain rounded-lg"
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                    <Smartphone className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0" />
                    <span>{t("qr.scanInstruction")}</span>
                  </div>

                  {qrTgUrl && (
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        disabled={openingTelegram}
                        onClick={() => handleOpenTelegram(qrTgUrl, true)}
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-xl bg-[#0B57D0] hover:bg-[#0842A0] active:bg-[#063177] dark:bg-[#A8C7FA] dark:hover:bg-[#c2d8fb] dark:text-[#062E6F] text-white font-medium text-xs sm:text-sm shadow-xs transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {openingTelegram ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {openingTelegram
                            ? t("qr.openingTelegram")
                            : t("qr.oneTapLogin")}
                        </span>
                        <ExternalLink className="h-3 w-3 opacity-75" />
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(qrTgUrl);
                            toast.success(t("qr.copiedLinkToast"));
                          } catch {
                            toast.info(qrTgUrl);
                          }
                        }}
                        className="inline-flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5 cursor-pointer"
                      >
                        <Copy className="h-3 w-3" />
                        <span>{t("qr.copyLink")}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === "otp" && (
            <form
              onSubmit={handleVerifyOTP}
              className="space-y-3 animate-in fade-in duration-200"
              noValidate
            >
              <div className="text-center space-y-0.5">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#EDF2FC] dark:bg-[#1a2744] mb-1">
                  <MessageSquare className="h-4 w-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
                </div>
                <h1 className="text-base sm:text-lg font-semibold text-foreground leading-tight">
                  {t("otp.title")}
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <Trans
                    t={t}
                    i18nKey="otp.subtitle"
                    values={{ phone: maskPhone(pending?.phone || sanitizePhone(phone)) }}
                    components={{
                      phone: (
                        <button
                          type="button"
                          onClick={() => {
                            if (!loading) setStep("phone");
                          }}
                          className="font-semibold text-foreground hover:text-[#0B57D0] dark:hover:text-[#A8C7FA] transition-colors underline-offset-2 hover:underline cursor-pointer"
                        />
                      ),
                    }}
                  />
                </p>
              </div>

              {deliveryType === "app" ? (
                <div className="p-3 rounded-2xl bg-sky-500/[0.08] dark:bg-sky-400/[0.08] text-left border border-sky-500/20 animate-in fade-in duration-200 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-sky-500/20 dark:bg-sky-400/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Send className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-sky-950 dark:text-sky-100">
                          {t("otp.delivery.appTitle")}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-800 dark:text-sky-300">
                          {t("otp.delivery.appBadge")}
                        </span>
                      </div>
                      <p className="text-[11px] text-sky-800/90 dark:text-sky-200/80 leading-relaxed mt-0.5">
                        {t("otp.delivery.appDesc")}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={openingTelegram}
                    onClick={() => handleOpenTelegram("tg://resolve?domain=telegram")}
                    className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-xl bg-[#0B57D0] hover:bg-[#0842A0] active:bg-[#063177] dark:bg-[#A8C7FA] dark:hover:bg-[#c2d8fb] dark:text-[#062E6F] text-white text-xs font-medium shadow-xs transition-all cursor-pointer disabled:opacity-60"
                  >
                    {openingTelegram ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {openingTelegram
                        ? t("qr.openingTelegram")
                        : t("otp.delivery.openApp")}
                    </span>
                    <ExternalLink className="h-3 w-3 opacity-75" />
                  </button>
                </div>
              ) : deliveryType === "sms" ? (
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-left border border-emerald-500/20 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5">
                    <Smartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-semibold text-foreground">
                        {t("otp.delivery.smsTitle")}
                      </span>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        {t("otp.delivery.smsDesc", {
                          phone: maskPhone(pending?.phone || sanitizePhone(phone)),
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              ) : deliveryType === "email" ? (
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-left animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5">
                    <Mail className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-semibold text-foreground">
                        {t("otp.delivery.emailTitle")}
                      </span>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        {t("otp.delivery.emailDesc", {
                          email: maskEmail(emailPattern),
                        })}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={emailBusy || loading}
                    onClick={handleResetLoginEmail}
                    className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-purple-700 dark:text-purple-300 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>{t("otp.delivery.emailReset")}</span>
                  </button>
                </div>
              ) : deliveryType === "call" ? (
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-left border border-amber-500/20 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5">
                    <PhoneCall className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-semibold text-foreground">
                        {t("otp.delivery.callTitle")}
                      </span>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        {t("otp.delivery.callDesc", {
                          phone: maskPhone(pending?.phone || sanitizePhone(phone)),
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              ) : deliveryType === "fragment" ? (
                <div className="p-2.5 rounded-xl bg-sky-500/10 text-left border border-sky-500/20 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5">
                    <ExternalLink className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-semibold text-foreground">
                        {t("otp.delivery.fragmentTitle")}
                      </span>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        {t("otp.delivery.fragmentDesc")}
                      </p>
                    </div>
                  </div>
                  {pending?.fragmentUrl && (
                    <button
                      type="button"
                      onClick={() => openUrl(pending.fragmentUrl!)}
                      className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-300 hover:underline cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{t("otp.delivery.fragmentOpen")}</span>
                    </button>
                  )}
                </div>
              ) : null}

              <div
                className={`flex justify-center ${
                  codeLength >= 6 ? "gap-1 sm:gap-1.5" : "gap-1.5 sm:gap-2"
                }`}
              >
                {otp.map((digit, idx) => (
                  <OtpBox
                    key={idx}
                    index={idx}
                    value={digit}
                    isFilled={digit.length > 0}
                    inputRef={(el) => {
                      otpRefs.current[idx] = el;
                    }}
                    disabled={loading}
                    onChange={(val) => handleOtpChange(idx, val)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    onPaste={handleOtpPaste}
                    totalDigits={codeLength}
                  />
                ))}
              </div>

              <ResendFooter
                floodUntil={floodUntil}
                resendAt={resendAt}
                nextDelivery={nextDelivery}
                resending={resending}
                loading={loading}
                onResend={handleResendCode}
              />

              <div className="space-y-1 pt-1">
                <PrimaryButton
                  loading={loading}
                  loadingLabel={t("otp.verifying")}
                  label={t("otp.verify")}
                  disabled={loading || otp.join("").length !== codeLength}
                />
                <BackButton
                  disabled={loading}
                  onClick={() => {
                    applyPending(null);
                    setStep("phone");
                    setOtp(Array.from({ length: codeLength }, () => ""));
                    setError(null);
                  }}
                  label={t("otp.differentNumber")}
                />
              </div>

              <div className="flex items-center justify-center gap-3 pt-0.5">
                <button
                  type="button"
                  onClick={openQrStep}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#0B57D0]/10 dark:hover:bg-[#A8C7FA]/10 py-1 px-3 rounded-full transition-colors cursor-pointer"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{t("otp.tryQr")}</span>
                </button>
              </div>
            </form>
          )}

          {step === "email" && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="text-center space-y-0.5">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 dark:bg-purple-400/10 text-purple-600 dark:text-purple-400 mb-1">
                  <Mail className="h-4 w-4" />
                </div>
                <h1 className="text-base sm:text-lg font-semibold text-foreground leading-tight">
                  {emailStage === "address"
                    ? t("emailSetup.title")
                    : t("emailSetup.codeTitle")}
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {emailStage === "address"
                    ? t("emailSetup.subtitle")
                    : t("emailSetup.codeSubtitle", {
                        email: maskEmail(emailPattern || emailAddress),
                      })}
                </p>
              </div>

              {emailStage === "address" ? (
                <form onSubmit={handleSendVerifyEmail} className="space-y-3" noValidate>
                  <FloatingInput
                    id="login-email"
                    label={t("emailSetup.emailLabel")}
                    placeholder={t("emailSetup.emailPlaceholder")}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={emailAddress}
                    onChange={(e) => {
                      setEmailAddress(e.target.value);
                      setError(null);
                    }}
                    disabled={emailBusy}
                    autoFocus
                  />
                  <PrimaryButton
                    loading={emailBusy}
                    loadingLabel={t("emailSetup.sending")}
                    label={t("emailSetup.send")}
                    disabled={emailBusy || !emailAddress.trim()}
                  />
                  <BackButton
                    disabled={emailBusy}
                    onClick={() => {
                      applyPending(null);
                      setStep("phone");
                      setError(null);
                    }}
                    label={t("emailSetup.back")}
                  />
                </form>
              ) : (
                <form onSubmit={handleVerifyEmail} className="space-y-3" noValidate>
                  <FloatingInput
                    id="login-email-code"
                    label={t("emailSetup.codeLabel")}
                    placeholder={t("emailSetup.codePlaceholder", {
                      count: emailCodeLength,
                    })}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={emailCodeLength}
                    value={emailCode}
                    onChange={(e) => {
                      setEmailCode(e.target.value.replace(/[^0-9]/g, ""));
                      setError(null);
                    }}
                    disabled={emailBusy}
                    autoFocus
                  />
                  <PrimaryButton
                    loading={emailBusy}
                    loadingLabel={t("emailSetup.verifying")}
                    label={t("emailSetup.verify")}
                    disabled={
                      emailBusy || emailCode.trim().length !== emailCodeLength
                    }
                  />
                  <div className="flex items-center justify-between px-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEmailStage("address");
                        setEmailCode("");
                        setError(null);
                      }}
                      className="text-[11px] font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer"
                    >
                      {t("emailSetup.changeEmail")}
                    </button>
                    <button
                      type="button"
                      disabled={emailBusy}
                      onClick={handleSendVerifyEmail}
                      className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline cursor-pointer disabled:opacity-50"
                    >
                      {t("emailSetup.resend")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {step === "password" && (
            <form
              onSubmit={handleVerifyPassword}
              className="space-y-3.5 animate-in fade-in duration-200"
              noValidate
            >
              <div className="text-center space-y-0.5">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400 mb-1">
                  <Lock className="h-4 w-4" />
                </div>
                <h1 className="text-base sm:text-lg font-semibold text-foreground leading-tight">
                  {t("password.title")}
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("password.subtitle")}
                </p>
              </div>

              <FloatingInput
                id="cloud-password"
                label={t("password.label")}
                placeholder={t("password.placeholder")}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                disabled={loading}
                autoFocus
                autoComplete="current-password"
                enterKeyHint="done"
                suffix={
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg cursor-pointer"
                    aria-label={showPassword ? t("password.hide") : t("password.show")}
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                }
              />

              <div className="space-y-1 pt-1">
                <PrimaryButton
                  loading={loading}
                  loadingLabel={t("password.signingIn")}
                  label={t("password.signIn")}
                  disabled={loading || !password}
                />
                <BackButton
                  disabled={loading}
                  onClick={() => {
                    const stored = pendingRef.current;
                    if (stored?.requiresPassword && !stored.phoneCodeHash) {
                      applyPending(null);
                      setStep("phone");
                    } else {
                      setStep(stored?.phoneCodeHash ? "otp" : "phone");
                    }
                    setPassword("");
                    setError(null);
                  }}
                  label={t("password.back")}
                />
              </div>
            </form>
          )}

          {step === "bootstrap" && (
            <div className="space-y-3 py-2 text-center animate-in fade-in duration-200">
              <div>
                <h1 className="text-base sm:text-lg font-semibold text-foreground">
                  {t("bootstrap.title")}
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("bootstrap.subtitle")}
                </p>
              </div>

              {bootstrapError ? (
                <div className="space-y-2.5">
                  <ErrorBanner message={bootstrapError} />
                  <PrimaryButton
                    type="button"
                    loading={false}
                    loadingLabel=""
                    label={t("bootstrap.retry")}
                    onClick={() => {
                      setBootstrapError(null);
                      setBootstrapStatus(t("bootstrap.reconnecting"));
                      try {
                        void completeAuthentication(getClient()).catch((err: any) => {
                          setBootstrapError(
                            err?.message || t("errors.bootstrapFailed")
                          );
                        });
                      } catch {
                        setStep("phone");
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-2">
                  <div className="relative w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-2 border-slate-200 dark:border-white/10" />
                    <div
                      className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
                      style={{
                        borderTopColor: "#0B57D0",
                        borderRightColor: "rgba(11,87,208,0.3)",
                        animationDuration: "0.8s",
                      }}
                    />
                    <div className="absolute inset-[5px] flex items-center justify-center">
                      <img
                        src="/teledrive.png"
                        alt=""
                        className="h-5 w-5 object-contain opacity-80"
                      />
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground bg-muted/60 px-3.5 py-1 rounded-full transition-all duration-300">
                    {bootstrapStatus}
                  </span>
                </div>
              )}
            </div>
          )}

          {step !== "bootstrap" && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={handleCopyDiagnostics}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
              >
                <Copy className="h-3 w-3" />
                <span>{t("diagnostics.copy")}</span>
              </button>
            </div>
          )}
        </div>

        {step !== "bootstrap" && (
          <div className="mt-2.5 sm:mt-3">
            <StepDots current={step} />
          </div>
        )}
      </div>

      <footer className="w-full text-center z-10 shrink-0">
        <p className="text-[10px] text-muted-foreground/60">
          {t("footer", { version: APP_VERSION })}
        </p>
      </footer>
    </div>
  );
}
