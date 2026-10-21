import React, { useState, useEffect, useRef } from "react";
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
  ShieldCheck,
} from "lucide-react";
import { Api, TelegramClient } from "telegram";
import { useAuthStore } from "@/stores/authStore";
import { initClient, getClient } from "@/lib/telegram/client";
import { saveSecret, getSecret, VAULT_KEY_SESSION, VAULT_KEY_PHONE, VAULT_KEY_API_ID, VAULT_KEY_API_HASH } from "@/lib/secure/vault";
import { bootstrapTeleDrive } from "@/lib/telegram/bootstrap";
import { DEFAULT_API_ID, DEFAULT_API_HASH } from "@/lib/telegram/config";
import { safeComputeCheck } from "@/lib/telegram/srp-helper";
import { startQrLogin } from "@/lib/telegram/qr-helper";
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

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = "phone" | "qr" | "otp" | "password" | "bootstrap";
type DeliveryType = "app" | "sms" | "email" | "call" | "unknown";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sanitizePhone(raw: string): string {
  let clean = raw.trim().replace(/[^\d+]/g, "");
  if (clean.startsWith("00")) {
    clean = `+${clean.slice(2)}`;
  }
  if (clean.startsWith("+")) {
    return clean;
  }
  // Strip leading 0 if 11 digits (e.g. 09876543210 -> 9876543210)
  if (clean.startsWith("0") && clean.length === 11) {
    clean = clean.slice(1);
  }
  // 10 digits starting with 6, 7, 8, 9 (standard Indian mobile numbers)
  if (clean.length === 10 && /^[6-9]/.test(clean)) {
    return `+91${clean}`;
  }
  // 12 digits starting with 91 (India without +)
  if (clean.length === 12 && clean.startsWith("91")) {
    return `+${clean}`;
  }
  return `+${clean}`;
}

function parseTelegramError(err: any, t: any): string {
  const msg = err?.errorMessage || err?.message || "";
  if (msg.includes("PHONE_NUMBER_INVALID")) return t("errors.phoneNumberInvalid");
  if (msg.includes("PHONE_NUMBER_BANNED")) return t("errors.phoneNumberBanned");
  if (msg.includes("FLOOD_WAIT")) {
    const seconds = msg.match(/\d+/)?.[0];
    return seconds ? t("errors.floodWait", { count: Number(seconds) }) : t("errors.floodWaitFewSeconds");
  }
  if (msg.includes("PHONE_NUMBER_FLOOD") || msg.includes("PHONE_PASSWORD_FLOOD")) return t("errors.phoneFlood");
  if (msg.includes("SEND_CODE_UNAVAILABLE")) return t("errors.sendCodeUnavailable");
  if (msg.includes("PHONE_CODE_EMPTY") || msg.includes("PHONE_CODE_INVALID")) return t("errors.invalidCode");
  if (msg.includes("PHONE_CODE_EXPIRED")) return t("errors.codeExpired");
  if (msg.includes("PASSWORD_HASH_INVALID") || msg.includes("Incorrect password")) return t("errors.incorrectPassword");
  if (msg.includes("PASSWORD_EMPTY")) return t("errors.passwordEmpty");
  if (msg.includes("AUTH_RESTART")) return "Telegram restarted the authentication. Please try again.";
  if (msg.includes("AUTH_KEY_UNREGISTERED") || msg.includes("AUTH_KEY_INVALID")) return "Session is invalid. Please try again.";
  if (msg.includes("NETWORK_MIGRATE") || msg.includes("USER_MIGRATE") || msg.includes("PHONE_MIGRATE")) return "Redirecting to the correct Telegram server, please retry...";
  if (msg.includes("CONNECTION_NOT_INITED")) return "Connection issue. Please try again.";
  if (msg.includes("RPC_CALL_FAIL") || msg.includes("RPC_MCGET_FAIL")) return "Telegram server error. Please try again.";
  if (msg.includes("SESSION_PASSWORD_NEEDED")) return "Two-step verification required. Please enter your password.";
  if (msg.includes("NETWORK_ERROR") || msg.includes("Network request failed") || msg.includes("net::ERR")) return "Network error. Please check your internet connection and try again.";
  return msg || t("errors.sendCodeFailed");
}

// ─── Animated step indicator ──────────────────────────────────────────────────
function StepDots({ current }: { current: Step }) {
  const visibleSteps: Step[] = ["phone", "otp", "password"];
  const stepToMap = current === "qr" ? "phone" : current;
  const currentIndex = visibleSteps.indexOf(stepToMap as any);
  if (currentIndex === -1) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 pt-1" aria-hidden="true">
      {visibleSteps.map((s, i) => (
        <div
          key={s}
          className={cn(
            "transition-all duration-300 ease-out rounded-full",
            i === currentIndex
              ? "w-6 h-1.5 bg-[#0B57D0] dark:bg-[#A8C7FA]"
              : i < currentIndex
              ? "w-2 h-1.5 bg-[#0B57D0]/50 dark:bg-[#A8C7FA]/50"
              : "w-1.5 h-1.5 bg-slate-200 dark:bg-white/15"
          )}
        />
      ))}
    </div>
  );
}

// ─── Floating label input ─────────────────────────────────────────────────────
interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
  suffix?: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

function FloatingInput({ label, id, suffix, inputRef, className, ...props }: FloatingInputProps) {
  const [focused, setFocused] = useState(false);
  const hasValue = Boolean(props.value);
  const lifted = focused || hasValue;

  return (
    <div className="relative group w-full text-left">
      <label
        htmlFor={id}
        className="absolute left-4 transition-all duration-200 ease-out pointer-events-none z-10 select-none whitespace-nowrap overflow-hidden text-ellipsis max-w-[calc(100%-24px)]"
        style={{
          top: lifted ? "7px" : "50%",
          transform: lifted ? "none" : "translateY(-50%)",
          fontSize: lifted ? "10px" : "13px",
          color: focused ? "var(--color-brand-500)" : lifted ? "var(--color-muted-foreground)" : "var(--color-muted-foreground)",
          fontWeight: lifted ? 600 : 400,
          letterSpacing: lifted ? "0.02em" : "normal",
        }}
      >
        {label}
      </label>
      <Input
        ref={inputRef as any}
        id={id}
        {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        className={cn(
          "h-12 pt-4 pb-1 px-4 rounded-xl text-base sm:text-sm font-medium",
          "border transition-all duration-200 outline-none",
          "bg-slate-50/80 dark:bg-[#1A1D24]/80 hover:bg-slate-100/80 dark:hover:bg-[#1E222A]",
          "text-foreground",
          focused
            ? "border-[#0B57D0] dark:border-[#A8C7FA] shadow-[0_0_0_3px_rgba(11,87,208,0.15)] dark:shadow-[0_0_0_3px_rgba(168,199,250,0.18)] bg-white dark:bg-[#16181F]"
            : "border-slate-200 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.12]",
          props.disabled ? "opacity-60 cursor-not-allowed" : "cursor-text",
          "focus-visible:ring-0 focus-visible:border-[#0B57D0] dark:focus-visible:border-[#A8C7FA]",
          suffix ? "pr-10" : "pr-4",
          className
        )}
      />
      {suffix && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">{suffix}</div>
      )}
    </div>
  );
}

// ─── OTP digit box ────────────────────────────────────────────────────────────
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

function OtpBox({ value, onChange, onKeyDown, onPaste, inputRef, disabled, index, isFilled, totalDigits }: OtpBoxProps) {
  const { t } = useTranslation("auth");
  const [focused, setFocused] = useState(false);

  return (
    <div
      className="relative transition-transform duration-150"
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
        className={cn(
          totalDigits >= 6
            ? "w-9 h-12 sm:w-11 sm:h-13 text-lg sm:text-xl"
            : "w-11 h-13 sm:w-12 sm:h-14 text-xl sm:text-2xl",
          "text-center font-mono font-bold rounded-2xl",
          "border transition-all duration-200 outline-none",
          "bg-slate-50 dark:bg-[#181A20]",
          "text-foreground",
          focused
            ? "border-[#0B57D0] dark:border-[#A8C7FA] ring-2 ring-[#0B57D0]/25 dark:ring-[#A8C7FA]/30 bg-white dark:bg-[#20232B] scale-[1.04]"
            : isFilled
            ? "border-[#0B57D0]/60 dark:border-[#A8C7FA]/70 bg-blue-50/50 dark:bg-[#0B57D0]/20 text-[#0B57D0] dark:text-[#A8C7FA]"
            : "border-slate-200 dark:border-white/[0.10] hover:border-slate-300 dark:hover:border-white/[0.18]",
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-text",
          "caret-transparent"
        )}
      />
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="w-full flex items-start gap-2.5 p-3 rounded-2xl bg-rose-500/[0.08] dark:bg-rose-500/[0.15] border border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs animate-in fade-in duration-200 text-left shadow-xs">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
      <span className="leading-snug font-medium text-xs">{message}</span>
    </div>
  );
}

// ─── Primary action button ────────────────────────────────────────────────────
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
      className={cn(
        "w-full h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-semibold tracking-wide",
        "bg-[#0B57D0] hover:bg-[#0842A0] active:scale-[0.99]",
        "dark:bg-[#A8C7FA] dark:hover:bg-[#c2d8fb] dark:active:bg-[#d3e3fd] dark:text-[#002B49]",
        "text-white shadow-sm hover:shadow-md",
        "transition-all duration-200",
        "cursor-pointer",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100",
        "relative overflow-hidden"
      )}
    >
      <span className={`flex items-center justify-center gap-2 transition-all duration-200 ${loading ? "opacity-0" : "opacity-100"}`}>
        {label}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs font-medium">{loadingLabel}</span>
        </span>
      )}
    </Button>
  );
}

// ─── Ghost back button ────────────────────────────────────────────────────────
function BackButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-slate-100/70 dark:hover:bg-white/[0.06] rounded-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

// ─── Main AuthPage ────────────────────────────────────────────────────────────
export default function AuthPage() {
  const { t, i18n } = useTranslation(["auth", "common"]);
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  // Auth credential check
  const [configApiId, setConfigApiId] = useState<number | null>(null);
  const [configApiHash, setConfigApiHash] = useState<string | null>(null);
  const [checkingConfig, setCheckingConfig] = useState(true);

  // Step state
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [codeLength, setCodeLength] = useState<number>(5);
  const [otp, setOtp] = useState<string[]>(["", "", "", "", ""]);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("unknown");
  const [emailPattern, setEmailPattern] = useState("");
  const [countdown, setCountdown] = useState<number>(0);
  const [resending, setResending] = useState(false);

  // QR Code login state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrTgUrl, setQrTgUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const qrCleanupRef = useRef<(() => void) | null>(null);

  // Password & bootstrap state
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState(() => t("bootstrap.connecting"));
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  // Dynamic OTP box refs
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Load API credentials from vault on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const id = await getSecret(VAULT_KEY_API_ID);
        const hash = await getSecret(VAULT_KEY_API_HASH);
        setConfigApiId(id ? parseInt(id) : DEFAULT_API_ID);
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

  // Auto-focus first OTP box when entering that step
  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  // Countdown timer for resending OTP
  useEffect(() => {
    if (step !== "otp" || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, countdown]);

  // Start QR login when step === "qr"
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
            }
          },
          onSuccess: async () => {
            if (isSubscribed) {
              await completeAuthentication(client);
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
              setError(parseTelegramError(err, t));
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
          setError(parseTelegramError(err, t));
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
  }, [step, configApiId, configApiHash]);

  // ── Step 1: Send code ────────────────────────────────────────────────────
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedPhone = sanitizePhone(phone);
    if (!phone.trim()) { setError(t("errors.phoneRequired")); return; }
    if (formattedPhone.length < 7 || !/^\+[0-9]{6,16}$/.test(formattedPhone)) {
      setError(t("errors.phoneNumberInvalid"));
      return;
    }
    if (!configApiId || !configApiHash) { setError(t("errors.apiCredentialsMissing")); return; }

    setLoading(true);
    setError(null);

    try {
      // Always force a fresh client for phone login — this is critical when the user
      // previously attempted QR login (which leaves the client in a different auth state).
      await initClient(configApiId, configApiHash, "", true);
      const client = getClient();

      // Retry loop handling Telegram DC migration or AUTH_RESTART
      let result: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await client.invoke(
            new Api.auth.SendCode({
              phoneNumber: formattedPhone,
              apiId: configApiId,
              apiHash: configApiHash,
              settings: new Api.CodeSettings({
                allowAppHash: true,
                currentNumber: true,
              }),
            })
          );
          console.log("Telegram SendCode result:", result);
          break;
        } catch (err: any) {
          const errMsg = err?.errorMessage || err?.message || "";
          if ((errMsg.includes("AUTH_RESTART") || errMsg.includes("CONNECTION_NOT_INITED")) && attempt < 2) {
            console.warn(`SendCode attempt ${attempt + 1} failed (${errMsg}), retrying...`);
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          if (errMsg.includes("PHONE_MIGRATE") || errMsg.includes("NETWORK_MIGRATE") || errMsg.includes("USER_MIGRATE")) {
            // Extract DC number and let the client handle the migration
            console.warn("DC migration required:", errMsg);
            await new Promise((r) => setTimeout(r, 500));
            if (attempt < 2) continue;
          }
          throw err;
        }
      }

      if (!result) throw new Error("Failed to send code after retries. Please try again.");

      const typeClass = result?.type?.className || "";
      let detectedDelivery: DeliveryType = "unknown";
      if (
        result?.type instanceof Api.auth.SentCodeTypeApp ||
        typeClass === "auth.SentCodeTypeApp" ||
        result?.type?.CONSTRUCTOR_ID === 1035688326
      ) {
        detectedDelivery = "app";
      } else if (
        result?.type instanceof Api.auth.SentCodeTypeSms ||
        typeClass === "auth.SentCodeTypeSms" ||
        typeClass === "auth.SentCodeTypeFirebaseSms" ||
        typeClass === "auth.SentCodeTypeFragmentSms"
      ) {
        detectedDelivery = "sms";
      } else if (
        result?.type instanceof Api.auth.SentCodeTypeEmailCode ||
        typeClass === "auth.SentCodeTypeEmailCode"
      ) {
        detectedDelivery = "email";
        setEmailPattern(result.type?.emailPattern || "");
      } else if (
        typeClass === "auth.SentCodeTypeCall" ||
        typeClass === "auth.SentCodeTypeFlashCall" ||
        typeClass === "auth.SentCodeTypeMissedCall"
      ) {
        detectedDelivery = "call";
      }
      setDeliveryType(detectedDelivery);

      const returnedLength = result?.type?.length;
      const detectedLength =
        typeof returnedLength === "number" && returnedLength >= 4 && returnedLength <= 8
          ? returnedLength
          : 5;
      setCodeLength(detectedLength);
      setOtp(new Array(detectedLength).fill(""));
      setPhoneCodeHash(result.phoneCodeHash);

      const timeoutSec =
        typeof result?.timeout === "number" && result.timeout > 0
          ? result.timeout
          : detectedDelivery === "app"
          ? 30
          : 60;
      setCountdown(timeoutSec);

      setStep("otp");

      if (detectedDelivery === "app") {
        toast.success(t("toasts.codeSentApp"));
      } else if (detectedDelivery === "sms") {
        toast.success(t("toasts.codeSentSms"));
      } else if (detectedDelivery === "email") {
        toast.success(t("toasts.codeSentEmail"));
      } else {
        toast.success(t("toasts.codeSent"));
      }
    } catch (err: any) {
      console.error("Send code failed:", err);
      setError(parseTelegramError(err, t));
    } finally {
      setLoading(false);
    }
  };

  // ── Client Resilience Helper ─────────────────────────────────────────────
  const getOrInitClient = async (): Promise<TelegramClient> => {
    try {
      const client = getClient();
      if (!client.connected) {
        await client.connect();
      }
      return client;
    } catch {
      if (!configApiId || !configApiHash) {
        throw new Error("Telegram API credentials missing. Please check settings.");
      }
      await initClient(configApiId, configApiHash);
      return getClient();
    }
  };

  // ── Resend Code ──────────────────────────────────────────────────────────
  const handleResendCode = async () => {
    if (resending || countdown > 0 || !configApiId || !configApiHash) return;
    setResending(true);
    setError(null);

    try {
      const client = await getOrInitClient();
      const formattedPhone = sanitizePhone(phone);

      const resendResult: any = await client.invoke(
        new Api.auth.ResendCode({
          phoneNumber: formattedPhone,
          phoneCodeHash: phoneCodeHash,
        })
      );

      if (resendResult?.phoneCodeHash) {
        setPhoneCodeHash(resendResult.phoneCodeHash);
      }

      const newTypeClass = resendResult?.type?.className || "";
      if (
        newTypeClass === "auth.SentCodeTypeSms" ||
        newTypeClass === "auth.SentCodeTypeFirebaseSms" ||
        newTypeClass === "auth.SentCodeTypeFragmentSms"
      ) {
        setDeliveryType("sms");
      }

      const timeoutSec =
        typeof resendResult?.timeout === "number" && resendResult.timeout > 0
          ? resendResult.timeout
          : 60;
      setCountdown(timeoutSec);

      toast.success(t("otp.resend.successToast"));
    } catch (err: any) {
      console.error("Resend code failed:", err);
      const errMsg = err?.errorMessage || err?.message || "";
      if (errMsg.includes("SEND_CODE_UNAVAILABLE")) {
        toast.info(t("otp.resend.unavailableToast"));
        setDeliveryType("app");
      } else {
        setError(parseTelegramError(err, t));
      }
    } finally {
      setResending(false);
    }
  };

  // ── Verify Code Execution ────────────────────────────────────────────────
  const executeVerifyCode = async (codeToVerify: string) => {
    if (!configApiId || !configApiHash) return;
    setLoading(true);
    setError(null);

    try {
      const client = await getOrInitClient();
      const formattedPhone = sanitizePhone(phone);

      try {
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: formattedPhone,
            phoneCodeHash,
            phoneCode: codeToVerify,
          })
        );
        await completeAuthentication(client);
      } catch (err: any) {
        const errMsg = err?.errorMessage || err?.message || "";
        if (errMsg.includes("SESSION_PASSWORD_NEEDED")) {
          setStep("password");
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.error("OTP verification failed:", err);
      setError(parseTelegramError(err, t));
      setOtp(new Array(codeLength).fill(""));
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP handlers ──────────────────────────────────────────
  const handleOtpChange = (index: number, val: string) => {
    const cleanVal = val.replace(/[^0-9]/g, "").slice(0, 1);
    const newOtp = [...otp];
    newOtp[index] = cleanVal;
    setOtp(newOtp);

    if (cleanVal && index < codeLength - 1) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-verify when all digits are filled
    const fullCode = newOtp.join("");
    if (cleanVal && fullCode.length === codeLength && !newOtp.includes("")) {
      setTimeout(() => {
        executeVerifyCode(fullCode);
      }, 50);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
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
    const rawDigits = e.clipboardData.getData("text").replace(/[^0-9]/g, "");
    if (!rawDigits) return;

    const targetLength =
      rawDigits.length >= 5 && rawDigits.length <= 8
        ? rawDigits.length
        : codeLength;

    if (targetLength !== codeLength) {
      setCodeLength(targetLength);
    }

    const digits = rawDigits.slice(0, targetLength).split("");
    const newOtp = new Array(targetLength).fill("");
    digits.forEach((d, i) => { newOtp[i] = d; });
    setOtp(newOtp);

    const focusIndex = Math.min(digits.length, targetLength - 1);
    setTimeout(() => { otpRefs.current[focusIndex]?.focus(); }, 0);

    if (digits.length === targetLength) {
      setTimeout(() => {
        executeVerifyCode(digits.join(""));
      }, 60);
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

  const toggleCodeLength = () => {
    const newLen = codeLength === 5 ? 6 : 5;
    setCodeLength(newLen);
    setOtp((prev) => {
      const updated = new Array(newLen).fill("");
      for (let i = 0; i < Math.min(prev.length, newLen); i++) {
        updated[i] = prev[i];
      }
      return updated;
    });
    setError(null);
    setTimeout(() => { otpRefs.current[0]?.focus(); }, 50);
  };

  // ── Step 3: 2FA password ─────────────────────────────────────────────────
  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { setError(t("errors.passwordRequired")); return; }

    setLoading(true);
    setError(null);

    try {
      const client = await getOrInitClient();
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
      await client.invoke(new Api.auth.CheckPassword({ password: passwordParam }));
      await completeAuthentication(client);
    } catch (err: any) {
      console.error("2FA password failed:", err);
      setError(parseTelegramError(err, t));
    } finally {
      setLoading(false);
    }
  };

  // ── Complete auth ────────────────────────────────────────────────────────
  const completeAuthentication = async (client: any) => {
    const sessionString = client.session.save() as string;
    let authPhone = sanitizePhone(phone);

    if (!phone.trim()) {
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

    setStep("bootstrap");
    try {
      await bootstrapTeleDrive((status) => { setBootstrapStatus(status); }, authPhone);
      toast.success(t("toasts.ready"));
      setSession(sessionString, authPhone);
      navigate("/drive/my-drive");
    } catch (err: any) {
      console.error("Bootstrap failed:", err);
      setBootstrapError(err.message || t("errors.bootstrapFailed"));
    }
  };

  // ── Loading screen ───────────────────────────────────────────────────────
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

  // ── Main render (Minimal, refined, zero-scroll mobile & desktop) ───────────
  return (
    <div className="fixed inset-0 h-[100dvh] w-full overflow-hidden bg-[#F8FAFD] dark:bg-[#0A0C10] select-none flex flex-col justify-between items-center py-4 sm:py-7 px-4 relative transition-colors duration-300">
      {/* Ambient background glow & atmospheric depth */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-[15%] left-1/2 -translate-x-1/2 w-[700px] h-[450px] bg-gradient-to-b from-[#0B57D0]/12 via-[#4C8DF6]/6 to-transparent dark:from-[#0B57D0]/22 dark:via-[#A8C7FA]/6 dark:to-transparent rounded-full blur-3xl opacity-80" />
        <div className="absolute -bottom-[20%] left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-gradient-to-t from-indigo-500/10 via-[#0B57D0]/5 to-transparent dark:from-[#1A2744]/40 dark:to-transparent rounded-full blur-3xl opacity-60" />
      </div>

      {/* Language switcher — unobtrusive top-right placement */}
      <div className="absolute top-3 right-3 sm:top-5 sm:right-6 z-30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-3 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground bg-white/70 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.1] border border-black/5 dark:border-white/[0.08] shadow-xs backdrop-blur-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Languages className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
              <span>{SUPPORTED_LANGUAGES.find((l) => l.code === (i18n.resolvedLanguage || i18n.language))?.label ?? "English"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 p-1.5 rounded-2xl bg-popover/95 backdrop-blur-xl border border-border/80 shadow-xl">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const currentLng = i18n.resolvedLanguage || i18n.language;
              const isSelected = currentLng === lang.code;
              return (
                <DropdownMenuItem
                  key={lang.code}
                  onClick={() => i18n.changeLanguage(lang.code)}
                  className={cn(
                    "flex items-center justify-between px-3 py-1.5 text-xs rounded-xl cursor-pointer transition-colors",
                    isSelected
                      ? "bg-[#C2E7FF]/40 dark:bg-[#004A77]/50 text-[#0B57D0] dark:text-[#A8C7FA] font-medium"
                      : "text-foreground hover:bg-muted/60"
                  )}
                >
                  <span>{lang.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main card column — centered vertically with zero scroll */}
      <div className="my-auto w-full max-w-[390px] sm:max-w-[430px] flex flex-col items-center justify-center z-10 animate-in fade-in duration-300">

        {/* ── Brand Logo & Tagline ── */}
        <div className="flex flex-col items-center mb-4 sm:mb-5">
          <Link to="/drive/my-drive" className="inline-flex items-center gap-3 group">
            <div className="relative">
              <div className="absolute -inset-1.5 rounded-2xl bg-gradient-to-tr from-[#0B57D0]/30 to-[#A8C7FA]/30 blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <img
                src="/teledrive.png"
                alt="TeleDrive"
                className="relative h-11 w-11 sm:h-12 sm:w-12 object-contain drop-shadow-md transition-transform duration-200 group-hover:scale-105"
              />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-2xl sm:text-[26px] font-bold tracking-tight text-foreground flex items-center gap-1.5 leading-tight">
                TeleDrive
              </span>
              <span className="text-xs font-medium text-muted-foreground -mt-0.5 tracking-wide">
                Unlimited Cloud Storage
              </span>
            </div>
          </Link>
        </div>

        {/* ── Main Surface Card (Glassmorphic, crisp border, elegant elevation) ── */}
        <div className="w-full bg-white/95 dark:bg-[#13151A]/95 backdrop-blur-2xl rounded-3xl border border-slate-200/90 dark:border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.04)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.04)] p-6 sm:p-8 transition-all duration-300 space-y-4">

          {/* Error banner */}
          {error && (
            <div className="mb-1">
              <ErrorBanner message={error} />
            </div>
          )}

          {/* ── PHONE / QR ── */}
          {(step === "phone" || step === "qr") && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Tab switcher */}
              <div className="flex bg-[#F0F4F9] dark:bg-[#1A1D24] p-1 rounded-2xl border border-black/[0.03] dark:border-white/[0.05]">
                <button
                  type="button"
                  onClick={() => { setStep("phone"); setError(null); }}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer",
                    step === "phone"
                      ? "bg-white dark:bg-[#252830] text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  <span>{t("phone.tabPhone")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setStep("qr"); setError(null); }}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer",
                    step === "qr"
                      ? "bg-white dark:bg-[#252830] text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{t("phone.tabQr")}</span>
                </button>
              </div>

              {/* Phone form */}
              {step === "phone" && (
                <form onSubmit={handleSendCode} className="space-y-4" noValidate>
                  <div className="text-center space-y-1">
                    <h1 className="text-base sm:text-lg font-semibold text-foreground leading-tight">
                      {t("phone.title")}
                    </h1>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("phone.subtitle")}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <FloatingInput
                      id="phone-number"
                      label={t("phone.label")}
                      type="tel"
                      inputMode="tel"
                      enterKeyHint="next"
                      value={phone}
                      onChange={(e) => { setPhone(e.target.value); setError(null); }}
                      disabled={loading}
                      autoComplete="tel"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.form?.requestSubmit(); }}
                    />
                    {phone.trim().length >= 5 && (
                      <div className="flex items-center gap-1.5 px-1 text-xs text-[#0B57D0] dark:text-[#A8C7FA] font-medium animate-in fade-in duration-150">
                        <span>Will send code to:</span>
                        <span className="font-mono font-semibold">{sanitizePhone(phone)}</span>
                      </div>
                    )}
                    {/* Clear, gentle delivery tip */}
                    <div className="flex items-start gap-2 px-1 text-[11px] text-muted-foreground leading-snug">
                      <Info className="h-3.5 w-3.5 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5" />
                      <span>Telegram delivers codes to your <strong>Telegram app</strong> first. SMS available as fallback.</span>
                    </div>
                  </div>

                  <PrimaryButton
                    loading={loading}
                    loadingLabel={t("phone.sending")}
                    label={t("phone.next")}
                    disabled={loading || !phone.trim()}
                  />

                  <p className="text-center text-[10px] text-muted-foreground/80 leading-relaxed">
                    <Trans
                      t={t}
                      i18nKey="phone.terms"
                      components={{
                        terms: <span className="text-[#0B57D0] dark:text-[#A8C7FA] cursor-pointer hover:underline" />,
                      }}
                    />
                  </p>
                </form>
              )}

              {/* QR tab */}
              {step === "qr" && (
                <div className="space-y-4 text-center">
                  <div className="space-y-1">
                    <h1 className="text-base sm:text-lg font-semibold text-foreground leading-tight">
                      {t("qr.title")}
                    </h1>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("qr.subtitle")}
                    </p>
                  </div>

                  {qrTgUrl && (
                    <a
                      href={qrTgUrl}
                      className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#A8C7FA] dark:hover:bg-[#c2d8fb] text-white dark:text-[#002B49] font-semibold text-xs sm:text-sm shadow-sm transition-all"
                    >
                      <Send className="h-4 w-4" />
                      <span>Log in with Telegram App (1-Tap)</span>
                      <ExternalLink className="h-3.5 w-3.5 opacity-75" />
                    </a>
                  )}

                  <div className="flex flex-col items-center py-1">
                    <div className="p-3 bg-white rounded-2xl shadow-xs border border-black/10">
                      {qrLoading || !qrDataUrl ? (
                        <div className="w-[140px] h-[140px] sm:w-[160px] sm:h-[160px] flex flex-col items-center justify-center gap-2">
                          <Loader2 className="h-6 w-6 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
                          <span className="text-[11px] font-medium text-muted-foreground">{t("qr.refreshing")}</span>
                        </div>
                      ) : (
                        <img
                          src={qrDataUrl}
                          alt="Telegram QR Login"
                          className="w-[140px] h-[140px] sm:w-[160px] sm:h-[160px] object-contain rounded-lg"
                        />
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5 text-left bg-muted/50 p-3 rounded-2xl text-xs text-foreground/80 border border-border/40">
                    {([t("qr.step1"), t("qr.step2"), t("qr.step3")] as string[]).map((stepText, i) => (
                      <div key={i} className="flex items-center gap-2.5 leading-snug">
                        <span className="w-4.5 h-4.5 rounded-full bg-[#0B57D0]/10 dark:bg-[#A8C7FA]/20 text-[#0B57D0] dark:text-[#A8C7FA] font-bold text-[10px] flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <span>{stepText}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── OTP ── */}
          {step === "otp" && (
            <form onSubmit={handleVerifyOTP} className="space-y-4 animate-in fade-in duration-200" noValidate>
              <div className="text-center space-y-1">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-[#0B57D0]/10 dark:bg-[#A8C7FA]/15 text-[#0B57D0] dark:text-[#A8C7FA] mb-1">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <h1 className="text-lg sm:text-xl font-bold text-foreground leading-tight">
                  {t("otp.title")}
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <Trans
                    t={t}
                    i18nKey="otp.subtitle"
                    values={{ phone: sanitizePhone(phone) }}
                    components={{
                      phone: (
                        <button
                          type="button"
                          onClick={() => { if (!loading) setStep("phone"); }}
                          className="font-semibold text-foreground hover:text-[#0B57D0] dark:hover:text-[#A8C7FA] transition-colors underline-offset-2 hover:underline cursor-pointer"
                        />
                      ),
                    }}
                  />
                </p>
              </div>

              {/* Delivery notification callout */}
              {deliveryType === "app" ? (
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-sky-500/[0.08] to-blue-500/[0.04] dark:from-[#0B57D0]/20 dark:to-[#1A2744]/40 border border-sky-500/20 dark:border-[#0B57D0]/30 text-left animate-in fade-in duration-200 space-y-2.5 shadow-xs">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-sky-500/15 dark:bg-[#A8C7FA]/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Send className="h-4 w-4 text-sky-600 dark:text-[#A8C7FA]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">
                          {t("otp.delivery.appTitle")}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 dark:bg-[#A8C7FA]/20 text-sky-700 dark:text-[#A8C7FA]">
                          {t("otp.delivery.appBadge")}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                        Telegram sent the code to your official <strong>"Telegram" notifications chat</strong> on your phone or PC.
                      </p>
                    </div>
                  </div>
                  <a
                    href="tg://resolve?domain=telegram"
                    className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-xl bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#A8C7FA] dark:hover:bg-[#c2d8fb] text-white dark:text-[#002B49] text-xs font-medium transition-all shadow-xs"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Open Telegram App</span>
                    <ExternalLink className="h-3 w-3 opacity-75" />
                  </a>
                </div>
              ) : deliveryType === "sms" ? (
                <div className="p-3.5 rounded-2xl bg-emerald-500/[0.08] dark:bg-emerald-500/[0.12] border border-emerald-500/20 text-left animate-in fade-in duration-200 space-y-1 shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                      <Smartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-foreground">
                        {t("otp.delivery.smsTitle")}
                      </span>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                        {t("otp.delivery.smsDesc", { phone: sanitizePhone(phone) })}
                      </p>
                    </div>
                  </div>
                </div>
              ) : deliveryType === "email" ? (
                <div className="p-3.5 rounded-2xl bg-purple-500/[0.08] dark:bg-purple-500/[0.12] border border-purple-500/20 text-left animate-in fade-in duration-200 space-y-1 shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                      <Mail className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-foreground">
                        {t("otp.delivery.emailTitle")}
                      </span>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                        {t("otp.delivery.emailDesc", { email: emailPattern || "your email" })}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* OTP digit boxes */}
              <div className={`flex justify-center ${codeLength >= 6 ? "gap-1.5 sm:gap-2" : "gap-2 sm:gap-2.5"}`}>
                {otp.map((digit, idx) => (
                  <OtpBox
                    key={idx}
                    index={idx}
                    value={digit}
                    isFilled={digit.length > 0}
                    inputRef={(el) => { otpRefs.current[idx] = el; }}
                    disabled={loading}
                    onChange={(val) => handleOtpChange(idx, val)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    onPaste={handleOtpPaste}
                    totalDigits={codeLength}
                  />
                ))}
              </div>

              {/* Countdown / Resend + code-length toggle on same row */}
              <div className="flex items-center justify-between px-1 text-xs">
                {countdown > 0 ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground/70" />
                    <span>Send via SMS in {countdown}s</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={resending || loading}
                    onClick={handleResendCode}
                    className="flex items-center gap-1.5 font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {resending ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span>Sending via SMS...</span></>
                    ) : (
                      <span>Didn't get code? Send via SMS</span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleCodeLength}
                  disabled={loading}
                  className="text-xs text-muted-foreground hover:text-[#0B57D0] dark:hover:text-[#A8C7FA] hover:underline cursor-pointer transition-colors"
                >
                  {codeLength === 5 ? t("otp.switchToSix") : t("otp.switchToFive")}
                </button>
              </div>

              <div className="space-y-1.5 pt-1">
                <PrimaryButton
                  loading={loading}
                  loadingLabel={t("otp.verifying")}
                  label={t("otp.verify")}
                  disabled={loading || otp.join("").length !== codeLength}
                />
                <BackButton
                  disabled={loading}
                  onClick={() => {
                    setStep("phone");
                    setCodeLength(5);
                    setOtp(["", "", "", "", ""]);
                    setError(null);
                  }}
                  label={t("otp.differentNumber")}
                />
              </div>

              {/* Prominent QR login fallback pill */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setStep("qr"); setError(null); }}
                  className="inline-flex items-center gap-2 text-xs font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#0B57D0]/10 dark:hover:bg-[#A8C7FA]/10 py-1.5 px-3.5 rounded-full transition-colors cursor-pointer"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{t("otp.tryQr")}</span>
                </button>
              </div>
            </form>
          )}

          {/* ── PASSWORD (2FA) ── */}
          {step === "password" && (
            <form onSubmit={handleVerifyPassword} className="space-y-4 animate-in fade-in duration-200" noValidate>
              <div className="text-center space-y-1">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-amber-500/10 dark:bg-amber-400/15 text-amber-600 dark:text-amber-400 mb-1">
                  <Lock className="h-5 w-5" />
                </div>
                <h1 className="text-lg sm:text-xl font-bold text-foreground leading-tight">
                  {t("password.title")}
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("password.subtitle")}
                </p>
              </div>

              <FloatingInput
                id="cloud-password"
                label={t("password.label")}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
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
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
              />

              <div className="space-y-1.5 pt-1">
                <PrimaryButton
                  loading={loading}
                  loadingLabel={t("password.signingIn")}
                  label={t("password.signIn")}
                  disabled={loading || !password}
                />
                <BackButton
                  disabled={loading}
                  onClick={() => { setStep("phone"); setPassword(""); setError(null); }}
                  label={t("password.back")}
                />
              </div>
            </form>
          )}

          {/* ── BOOTSTRAP ── */}
          {step === "bootstrap" && (
            <div className="space-y-4 py-3 text-center animate-in fade-in duration-200">
              <div className="space-y-1">
                <h1 className="text-base sm:text-lg font-semibold text-foreground">
                  {t("bootstrap.title")}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {t("bootstrap.subtitle")}
                </p>
              </div>

              {bootstrapError ? (
                <div className="space-y-3">
                  <ErrorBanner message={bootstrapError} />
                  <PrimaryButton
                    type="button"
                    loading={false}
                    loadingLabel=""
                    label={t("bootstrap.retry")}
                    onClick={() => {
                      setBootstrapError(null);
                      setBootstrapStatus(t("bootstrap.reconnecting"));
                      setStep("phone");
                      setTimeout(() => setStep("bootstrap"), 50);
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3.5 py-3">
                  <div className="relative w-14 h-14">
                    <div className="absolute inset-0 rounded-full border-2 border-slate-200 dark:border-white/10" />
                    <div
                      className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
                      style={{
                        borderTopColor: "#0B57D0",
                        borderRightColor: "rgba(11,87,208,0.3)",
                        animationDuration: "0.8s",
                      }}
                    />
                    <div className="absolute inset-[6px] flex items-center justify-center">
                      <img src="/teledrive.png" alt="" className="h-6 w-6 object-contain opacity-90" />
                    </div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground bg-muted/60 px-4 py-1.5 rounded-full transition-all duration-300">
                    {bootstrapStatus}
                  </span>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Step dots */}
        {step !== "bootstrap" && (
          <div className="mt-3 sm:mt-4">
            <StepDots current={step} />
          </div>
        )}
      </div>

      {/* Footer — pinned to bottom */}
      <footer className="w-full text-center z-10 shrink-0">
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
          <ShieldCheck className="h-3.5 w-3.5 text-[#0B57D0]/70 dark:text-[#A8C7FA]/70" />
          <span>{t("footer", { version: "0.1.2" })}</span>
        </p>
      </footer>
    </div>
  );
}
