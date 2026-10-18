import React, { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { AlertTriangle, Eye, EyeOff, Loader2, ArrowLeft, MessageSquare, Lock } from "lucide-react";
import { Api } from "telegram";
import { useAuthStore } from "@/stores/authStore";
import { initClient, getClient } from "@/lib/telegram/client";
import { saveSecret, getSecret, VAULT_KEY_SESSION, VAULT_KEY_PHONE, VAULT_KEY_API_ID, VAULT_KEY_API_HASH } from "@/lib/secure/vault";
import { bootstrapTeleDrive } from "@/lib/telegram/bootstrap";
import { DEFAULT_API_ID, DEFAULT_API_HASH } from "@/lib/telegram/config";
import { safeComputeCheck } from "@/lib/telegram/srp-helper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = "phone" | "otp" | "password" | "bootstrap";

// ─── Animated step indicator ──────────────────────────────────────────────────
function StepDots({ current }: { current: Step }) {
  const visibleSteps: Step[] = ["phone", "otp", "password"];
  const currentIndex = visibleSteps.indexOf(current as any);
  if (currentIndex === -1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mb-7">
      {visibleSteps.map((s, i) => (
        <div
          key={s}
          className="transition-all duration-500 ease-out rounded-full"
          style={{
            width: i === currentIndex ? "24px" : "6px",
            height: "6px",
            background:
              i < currentIndex
                ? "var(--color-brand-500)"
                : i === currentIndex
                ? "var(--color-brand-500)"
                : "#dadce0",
            opacity: i > currentIndex ? 0.4 : 1,
          }}
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
    <div className="relative group">
      <label
        htmlFor={id}
        className="absolute left-4 transition-all duration-200 ease-out pointer-events-none z-10 select-none"
        style={{
          top: lifted ? "7px" : "50%",
          transform: lifted ? "none" : "translateY(-50%)",
          fontSize: lifted ? "10px" : "14px",
          color: focused
            ? "var(--color-brand-500)"
            : lifted
            ? "#747775"
            : "#9aa0a6",
          fontWeight: lifted ? 500 : 400,
          letterSpacing: lifted ? "0.025em" : "normal",
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
        className={`
          h-14 pt-5 pb-1 px-4 rounded-2xl text-sm
          border-2 transition-all duration-200 outline-none
          bg-white dark:bg-[#282A2C]
          text-[#1f1f1f] dark:text-[#E3E3E3]
          ${focused
            ? "border-[#0B57D0] dark:border-[#A8C7FA] shadow-[0_0_0_3px_rgba(11,87,208,0.12)]"
            : "border-[#e0e3e7] dark:border-[#3c4043] hover:border-[#bdc1c6] dark:hover:border-[#5f6368]"}
          ${props.disabled ? "opacity-60 cursor-not-allowed" : "cursor-text"}
          focus-visible:ring-0 focus-visible:border-[#0B57D0] dark:focus-visible:border-[#A8C7FA]
          ${suffix ? "pr-12" : "pr-4"}
          ${className ?? ""}
        `}
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
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  index: number;
  isFilled: boolean;
}

function OtpBox({ value, onChange, onKeyDown, onPaste, inputRef, disabled, index, isFilled }: OtpBoxProps) {
  const { t } = useTranslation("auth");
  const [focused, setFocused] = useState(false);

  return (
    <div
      className="relative transition-all duration-200"
      style={{ transform: isFilled ? "scale(1.05)" : "scale(1)" }}
    >
      <input
        ref={inputRef as any}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        aria-label={t("otp.digit", { number: index + 1 })}
        className={`
          w-12 h-14 text-center font-bold text-xl rounded-2xl
          border-2 outline-none transition-all duration-200
          bg-white dark:bg-[#282A2C]
          text-[#1f1f1f] dark:text-[#E3E3E3]
          ${focused
            ? "border-[#0B57D0] dark:border-[#A8C7FA] shadow-[0_0_0_3px_rgba(11,87,208,0.12)]"
            : isFilled
            ? "border-[#1e8e3e] dark:border-[#81c995] bg-[#f0fdf4] dark:bg-[#1a2f1a]"
            : "border-[#e0e3e7] dark:border-[#3c4043]"}
          ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-text"}
          caret-transparent
        `}
      />
      {isFilled && !focused && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* subtle dot indicator already shown by the value */}
        </div>
      )}
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="w-full flex gap-2.5 p-3.5 rounded-2xl border border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 text-xs animate-slide-up-fade">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500 dark:text-rose-400" />
      <span className="leading-relaxed font-medium">{message}</span>
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
      className={`
        w-full h-12 rounded-full text-sm font-medium
        bg-[#0B57D0] hover:bg-[#0842A0] active:bg-[#063177]
        dark:bg-[#A8C7FA] dark:hover:bg-[#c2d8fb] dark:active:bg-[#d3e3fd]
        dark:text-[#062E6F]
        text-white shadow-sm
        transition-all duration-200
        cursor-pointer
        disabled:opacity-60 disabled:cursor-not-allowed
        relative overflow-hidden
      `}
    >
      <span className={`flex items-center justify-center gap-2 transition-all duration-200 ${loading ? "opacity-0" : "opacity-100"}`}>
        {label}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="ml-2">{loadingLabel}</span>
        </span>
      )}
    </Button>
  );
}

// ─── Ghost back button ────────────────────────────────────────────────────────
function BackButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className="w-full h-10 rounded-full hover:bg-[#EDF2FC] dark:hover:bg-[#282A2C] flex gap-2 justify-center items-center text-xs font-medium text-[#0B57D0] dark:text-[#A8C7FA] transition-all duration-200 cursor-pointer"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

// ─── Main AuthPage ────────────────────────────────────────────────────────────
export default function AuthPage() {
  const { t } = useTranslation("auth");
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
  const [otp, setOtp] = useState<string[]>(["", "", "", "", ""]);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState(() => t("bootstrap.connecting"));
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  // OTP box refs
  const otpRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

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
      setTimeout(() => otpRefs[0].current?.focus(), 100);
    }
  }, [step]);

  // ── Step 1: Send code ────────────────────────────────────────────────────
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) { setError(t("errors.phoneRequired")); return; }
    if (!configApiId || !configApiHash) { setError(t("errors.apiCredentialsMissing")); return; }

    setLoading(true);
    setError(null);

    try {
      await initClient(configApiId, configApiHash);
      const client = getClient();

      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone.trim(),
          apiId: configApiId,
          apiHash: configApiHash,
          settings: new Api.CodeSettings({}),
        })
      );

      setPhoneCodeHash((result as any).phoneCodeHash);
      setStep("otp");
      toast.success(t("toasts.codeSent"));
    } catch (err: any) {
      console.error("Send code failed:", err);
      setError(err.message || t("errors.sendCodeFailed"));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP ───────────────────────────────────────────────────
  const handleOtpChange = (index: number, val: string) => {
    const cleanVal = val.replace(/[^0-9]/g, "").slice(0, 1);
    const newOtp = [...otp];
    newOtp[index] = cleanVal;
    setOtp(newOtp);
    if (cleanVal && index < 4) otpRefs[index + 1].current?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs[index - 1].current?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const data = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 5);
    if (data.length > 0) {
      const newOtp = [...otp];
      data.split("").forEach((d, i) => { if (i < 5) newOtp[i] = d; });
      setOtp(newOtp);
      const focusIndex = Math.min(data.length, 4);
      otpRefs[focusIndex].current?.focus();
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 5) { setError(t("errors.incompleteCode")); return; }
    if (!configApiId || !configApiHash) return;

    setLoading(true);
    setError(null);

    try {
      const client = getClient();

      try {
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone.trim(),
            phoneCodeHash,
            phoneCode: code,
          })
        );
        await completeAuthentication(client);
      } catch (err: any) {
        if (err.message?.includes("SESSION_PASSWORD_NEEDED")) {
          setStep("password");
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.error("OTP verification failed:", err);
      setError(err.message || t("errors.invalidCode"));
      setOtp(["", "", "", "", ""]);
      otpRefs[0].current?.focus();
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: 2FA password ─────────────────────────────────────────────────
  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { setError(t("errors.passwordRequired")); return; }

    setLoading(true);
    setError(null);

    try {
      const client = getClient();
      const passwordConfig = await client.invoke(new Api.account.GetPassword());

      // safeComputeCheck handles all Buffer polyfill issues across platforms
      // (macOS, Windows WebView2, Linux). See src/lib/telegram/srp-helper.ts.
      const srpResult = await safeComputeCheck(passwordConfig as any, password);

      await client.invoke(
        new Api.auth.CheckPassword({ password: srpResult })
      );

      await completeAuthentication(client);
    } catch (err: any) {
      console.error("2FA Verification failed:", err);
      const msg = err.message || "";
      // Translate raw Telegram errors into user-friendly messages
      if (msg.includes("FLOOD_WAIT")) {
        const seconds = msg.match(/\d+/)?.[0];
        setError(seconds ? t("errors.floodWait", { count: Number(seconds) }) : t("errors.floodWaitFewSeconds"));
      } else if (msg.includes("PASSWORD_HASH_INVALID") || msg.includes("Incorrect password")) {
        setError(t("errors.incorrectPassword"));
      } else if (msg.includes("PASSWORD_EMPTY")) {
        setError(t("errors.passwordEmpty"));
      } else if (msg.includes("Platform compatibility")) {
        setError(msg);
      } else {
        setError(msg || t("errors.incorrectCloudPassword"));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Shared: complete auth flow ───────────────────────────────────────────
  const completeAuthentication = async (client: any) => {
    const sessionString = client.session.save() as string;

    try {
      await invoke("save_session", { session: sessionString, phone: phone.trim() });
    } catch (saveErr) {
      console.error("save_session (Rust) failed:", saveErr);
    }

    try {
      await saveSecret(VAULT_KEY_SESSION, sessionString);
      await saveSecret(VAULT_KEY_PHONE, phone.trim());
    } catch (vaultErr) {
      console.warn("Stronghold saveSecret failed (non-fatal):", vaultErr);
    }

    setStep("bootstrap");
    try {
      await bootstrapTeleDrive((status) => {
        setBootstrapStatus(status);
      }, phone.trim());
      toast.success(t("toasts.ready"));
      setSession(sessionString, phone.trim());
      navigate("/drive/my-drive");
    } catch (err: any) {
      console.error("Bootstrap failed:", err);
      setBootstrapError(err.message || t("errors.bootstrapFailed"));
    }
  };

  // ── Loading screen ───────────────────────────────────────────────────────
  if (checkingConfig) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background select-none">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-2 border-[#e0e3e7] dark:border-[#3c4043]" />
            <Loader2 className="h-12 w-12 animate-spin text-[#0B57D0] dark:text-[#A8C7FA] absolute inset-0" />
          </div>
          <span className="text-xs font-medium text-[#747775] dark:text-[#9aa0a6] mt-1">
            {t("loading")}
          </span>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="flex items-center justify-center min-h-screen bg-background relative select-none overflow-hidden">
      {/* Decorative background blobs */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      >
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full opacity-[0.04] dark:opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #0B57D0, transparent 70%)" }} />
        <div className="absolute bottom-[-15%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-[0.03] dark:opacity-[0.02]"
          style={{ background: "radial-gradient(circle, #1e8e3e, transparent 70%)" }} />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-[400px] mx-4 animate-fade-in">
        <div className="bg-white dark:bg-[#1E1F20] border border-[#e0e3e7] dark:border-[#2d2f31] rounded-3xl shadow-[0_4px_32px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_32px_rgba(0,0,0,0.3)] p-8 md:p-10">

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <Link to="/drive/my-drive" className="inline-flex items-center gap-2.5 group mb-1">
              <div className="relative">
                <img
                  src="/teledrive.png"
                  alt="TeleDrive"
                  className="h-10 w-10 object-contain transition-transform duration-300 group-hover:scale-110"
                />
              </div>
              <span className="text-2xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
                TeleDrive
              </span>
            </Link>
            <p className="text-[10px] font-medium tracking-widest uppercase text-[#9aa0a6] dark:text-[#747775] mt-1">
              {t("tagline")}
            </p>
          </div>

          {/* Error banner — shown above step content */}
          {error && (
            <div className="mb-5">
              <ErrorBanner message={error} />
            </div>
          )}

          {/* ── STEP 1: Phone ─────────────────────────────────────────── */}
          {step === "phone" && (
            <form onSubmit={handleSendCode} className="space-y-5 animate-slide-up-fade" noValidate>
              <div className="text-center space-y-1.5 mb-6">
                <h1 className="text-[22px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] leading-tight">
                  {t("phone.title")}
                </h1>
                <p className="text-sm text-[#747775] dark:text-[#9aa0a6] leading-relaxed">
                  {t("phone.subtitle")}
                </p>
              </div>

              <FloatingInput
                id="phone-number"
                label={t("phone.label")}
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(null); }}
                disabled={loading}
                autoComplete="tel"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.form?.requestSubmit(); }}
              />

              <div className="pt-1">
                <PrimaryButton
                  loading={loading}
                  loadingLabel={t("phone.sending")}
                  label={t("phone.next")}
                  disabled={loading || !phone.trim()}
                />
              </div>

              <p className="text-center text-[11px] text-[#9aa0a6] dark:text-[#747775] leading-relaxed pt-1">
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

          {/* ── STEP 2: OTP ───────────────────────────────────────────── */}
          {step === "otp" && (
            <form onSubmit={handleVerifyOTP} className="space-y-6 animate-slide-up-fade" noValidate>
              <div className="text-center space-y-1.5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#EDF2FC] dark:bg-[#1a2744] mb-3">
                  <MessageSquare className="h-5 w-5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                </div>
                <h1 className="text-[22px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] leading-tight">
                  {t("otp.title")}
                </h1>
                <p className="text-sm text-[#747775] dark:text-[#9aa0a6] leading-relaxed">
                  <Trans
                    t={t}
                    i18nKey="otp.subtitle"
                    values={{ phone }}
                    components={{
                      phone: (
                        <button
                          type="button"
                          onClick={() => { if (!loading) setStep("phone"); }}
                          className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] hover:text-[#0B57D0] dark:hover:text-[#A8C7FA] transition-colors underline-offset-2 hover:underline cursor-pointer"
                        />
                      ),
                    }}
                  />
                </p>
              </div>

              {/* OTP boxes */}
              <div className="flex justify-between gap-2 my-2">
                {otp.map((digit, idx) => (
                  <OtpBox
                    key={idx}
                    index={idx}
                    value={digit}
                    isFilled={digit.length > 0}
                    inputRef={otpRefs[idx]}
                    disabled={loading}
                    onChange={(val) => handleOtpChange(idx, val)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    onPaste={handleOtpPaste}
                  />
                ))}
              </div>

              {/* Progress strip */}
              <div className="flex gap-1.5">
                {otp.map((d, i) => (
                  <div
                    key={i}
                    className="flex-1 h-0.5 rounded-full transition-all duration-300"
                    style={{ background: d ? "#0B57D0" : "#e0e3e7" }}
                  />
                ))}
              </div>

              <div className="space-y-2.5">
                <PrimaryButton
                  loading={loading}
                  loadingLabel={t("otp.verifying")}
                  label={t("otp.verify")}
                  disabled={loading || otp.join("").length !== 5}
                />
                <BackButton
                  disabled={loading}
                  onClick={() => { setStep("phone"); setOtp(["", "", "", "", ""]); setError(null); }}
                  label={t("otp.differentNumber")}
                />
              </div>
            </form>
          )}

          {/* ── STEP 3: 2FA Password ──────────────────────────────────── */}
          {step === "password" && (
            <form onSubmit={handleVerifyPassword} className="space-y-5 animate-slide-up-fade" noValidate>
              <div className="text-center space-y-1.5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#FFF4EC] dark:bg-[#2a1f10] mb-3">
                  <Lock className="h-5 w-5 text-[#F9AB00] dark:text-[#fdd663]" />
                </div>
                <h1 className="text-[22px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] leading-tight">
                  {t("password.title")}
                </h1>
                <p className="text-sm text-[#747775] dark:text-[#9aa0a6] leading-relaxed">
                  {t("password.subtitle")}
                </p>
              </div>

              <div className="mt-2">
                <FloatingInput
                  id="cloud-password"
                  label={t("password.label")}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  disabled={loading}
                  autoFocus
                  autoComplete="current-password"
                  suffix={
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-[#747775] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] transition-colors p-1 rounded-lg cursor-pointer"
                      aria-label={showPassword ? t("password.hide") : t("password.show")}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />
              </div>

              <div className="space-y-2.5 pt-1">
                <PrimaryButton
                  loading={loading}
                  loadingLabel={t("password.signingIn")}
                  label={t("password.signIn")}
                  disabled={loading || !password}
                />
                <BackButton
                  disabled={loading}
                  onClick={() => { setStep("otp"); setPassword(""); setError(null); }}
                  label={t("password.back")}
                />
              </div>
            </form>
          )}

          {/* ── STEP 4: Bootstrap ─────────────────────────────────────── */}
          {step === "bootstrap" && (
            <div className="space-y-6 py-2 text-center animate-slide-up-fade">
              <div className="flex flex-col items-center gap-1.5 mb-2">
                <h1 className="text-[22px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {t("bootstrap.title")}
                </h1>
                <p className="text-sm text-[#747775] dark:text-[#9aa0a6]">
                  {t("bootstrap.subtitle")}
                </p>
              </div>

              {bootstrapError ? (
                <div className="space-y-4">
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
                <div className="flex flex-col items-center justify-center gap-5 py-6">
                  {/* Animated spinner ring */}
                  <div className="relative w-16 h-16">
                    <div className="absolute inset-0 rounded-full border-2 border-[#e0e3e7] dark:border-[#3c4043]" />
                    <div
                      className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
                      style={{
                        borderTopColor: "#0B57D0",
                        borderRightColor: "rgba(11,87,208,0.3)",
                        animationDuration: "0.8s",
                      }}
                    />
                    <div className="absolute inset-[6px] flex items-center justify-center">
                      <img src="/teledrive.png" alt="" className="h-7 w-7 object-contain opacity-80" />
                    </div>
                  </div>
                  <span className="text-xs font-medium text-[#747775] dark:text-[#9aa0a6] bg-[#F0F4F9] dark:bg-[#282A2C] px-4 py-1.5 rounded-full border border-[#e0e3e7] dark:border-[#3c4043] transition-all duration-500">
                    {bootstrapStatus}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Step dots (phone, otp, password only) */}
          {step !== "bootstrap" && (
            <div className="mt-8">
              <StepDots current={step} />
            </div>
          )}
        </div>

        {/* Footer note */}
        <p className="text-center text-[11px] text-[#9aa0a6] dark:text-[#5f6368] mt-4">
          {t("footer", { version: "0.1.1" })}
        </p>
      </div>
    </div>
  );
}
