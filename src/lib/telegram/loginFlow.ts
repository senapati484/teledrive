/**
 * Pure login-flow helpers for Telegram phone authentication.
 *
 * This module deliberately has no React, Tauri or storage dependencies so the
 * parsing, cooldown and error-mapping rules can be unit tested directly.
 */

import { parseFloodWaitSeconds } from "./rateLimit";

export type LoginDelivery =
  | "app"
  | "sms"
  | "call"
  | "email"
  | "emailSetup"
  | "fragment"
  | "unknown";

export interface SentCodeInfo {
  delivery: LoginDelivery;
  typeName: string;
  codeLength: number;
  phoneCodeHash: string;
  nextDelivery: LoginDelivery | null;
  nextTypeName: string | null;
  timeoutSeconds: number;
  emailPattern: string | null;
  resetAvailablePeriod: number | null;
  resetPendingDate: number | null;
  fragmentUrl: string | null;
}

export interface PendingLogin extends SentCodeInfo {
  /** E.164 phone number. */
  phone: string;
  /** Temporary session string that owns the auth key behind phoneCodeHash. */
  tempSession: string;
  sentAt: number;
  /** Epoch ms when Telegram allows requesting the next delivery method. */
  resendAt: number;
  /** Epoch ms after which we consider the pending code stale. */
  expiresAt: number;
  /** Epoch ms until which Telegram asked us to stop requesting codes. */
  floodUntil: number;
  /** True when a future auth token matched and Telegram only needs the 2FA password. */
  requiresPassword?: boolean;
}

const SENT_CODE_DELIVERY: Record<string, LoginDelivery> = {
  "auth.SentCodeTypeApp": "app",
  "auth.SentCodeTypeSms": "sms",
  "auth.SentCodeTypeFirebaseSms": "sms",
  "auth.SentCodeTypeFragmentSms": "fragment",
  "auth.SentCodeTypeCall": "call",
  "auth.SentCodeTypeFlashCall": "call",
  "auth.SentCodeTypeMissedCall": "call",
  "auth.SentCodeTypeEmailCode": "email",
  "auth.SentCodeTypeSetUpEmailRequired": "emailSetup",
  "auth.SentCodeTypeSmsWord": "sms",
  "auth.SentCodeTypeSmsPhrase": "sms",
};

const NEXT_DELIVERY: Record<string, LoginDelivery> = {
  "auth.CodeTypeSms": "sms",
  "auth.CodeTypeCall": "call",
  "auth.CodeTypeFlashCall": "call",
  "auth.CodeTypeMissedCall": "call",
  "auth.CodeTypeFragmentSms": "fragment",
};

export const MAX_CODE_REQUESTS_PER_HOUR = 3;
export const CODE_REQUEST_WINDOW_MS = 60 * 60 * 1000;
/** Conservatively treat an unconfirmed pending code as stale after 10 minutes. */
export const PENDING_CODE_TTL_MS = 10 * 60 * 1000;
/** Telegram's default resend delay when it does not send one explicitly. */
export const DEFAULT_RESEND_TIMEOUT_SECONDS = 60;

/** Returns a canonical constructor name even for minified/plain objects. */
export function classNameOf(value: any): string {
  const raw = value?.className || value?.constructor?.name || "";
  if (!raw) return "";
  return raw.includes(".") ? raw : `auth.${raw}`;
}

export function isSentCodeSuccess(result: any): boolean {
  return classNameOf(result) === "auth.SentCodeSuccess";
}

export function isEmailVerifiedLogin(result: any): boolean {
  return classNameOf(result) === "account.EmailVerifiedLogin";
}

export function isAuthorizationSignUpRequired(result: any): boolean {
  return classNameOf(result) === "auth.AuthorizationSignUpRequired";
}

/**
 * Converts an `auth.SentCode` (or `auth.ResendCode` result) into UI state.
 * Returns null when the result is not a SentCode.
 */
export function parseSentCode(result: any): SentCodeInfo | null {
  if (!result || typeof result !== "object") return null;
  if (isSentCodeSuccess(result)) return null;

  const type = result.type;
  if (!type) return null;

  const typeName = classNameOf(type);
  const nextTypeName = result.nextType ? classNameOf(result.nextType) : null;
  const rawLength = type?.length;
  const codeLength =
    typeof rawLength === "number" && rawLength > 0 ? rawLength : 0;
  const rawTimeout = result?.timeout;

  return {
    delivery: SENT_CODE_DELIVERY[typeName] ?? "unknown",
    typeName,
    codeLength,
    phoneCodeHash:
      typeof result.phoneCodeHash === "string" ? result.phoneCodeHash : "",
    nextDelivery: nextTypeName ? NEXT_DELIVERY[nextTypeName] ?? null : null,
    nextTypeName,
    timeoutSeconds:
      typeof rawTimeout === "number" && rawTimeout > 0
        ? rawTimeout
        : DEFAULT_RESEND_TIMEOUT_SECONDS,
    emailPattern:
      typeof type?.emailPattern === "string" ? type.emailPattern : null,
    resetAvailablePeriod:
      typeof type?.resetAvailablePeriod === "number"
        ? type.resetAvailablePeriod
        : null,
    resetPendingDate:
      typeof type?.resetPendingDate === "number"
        ? type.resetPendingDate
        : null,
    fragmentUrl: typeof type?.url === "string" ? type.url : null,
  };
}

export function pendingFromSentCode(
  phone: string,
  info: SentCodeInfo,
  tempSession: string,
  now: number = Date.now()
): PendingLogin {
  return {
    ...info,
    phone,
    tempSession,
    sentAt: now,
    resendAt: now + info.timeoutSeconds * 1000,
    expiresAt: now + PENDING_CODE_TTL_MS,
    floodUntil: 0,
  };
}

export function isPendingUsable(
  pending: PendingLogin | null,
  now: number = Date.now()
): pending is PendingLogin {
  return (
    !!pending &&
    (!!pending.phoneCodeHash || !!pending.requiresPassword) &&
    now < pending.expiresAt
  );
}

export interface CodeRequestBudget {
  allowed: boolean;
  used: number;
  limit: number;
  /** Seconds until a request becomes available again. */
  retryAfterSeconds: number;
}

export function pruneRequestTimes(
  times: number[],
  now: number = Date.now()
): number[] {
  return times.filter((t) => Number.isFinite(t) && now - t < CODE_REQUEST_WINDOW_MS);
}

export function checkCodeRequestBudget(
  times: number[],
  now: number = Date.now(),
  limit: number = MAX_CODE_REQUESTS_PER_HOUR
): CodeRequestBudget {
  const recent = pruneRequestTimes(times, now).sort((a, b) => a - b);
  const used = recent.length;
  if (used < limit) {
    return { allowed: true, used, limit, retryAfterSeconds: 0 };
  }
  const oldest = recent[used - limit] ?? recent[0];
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((oldest + CODE_REQUEST_WINDOW_MS - now) / 1000)
  );
  return { allowed: false, used, limit, retryAfterSeconds };
}

export function recordRequestTime(
  times: number[],
  now: number = Date.now()
): number[] {
  return [...pruneRequestTimes(times, now), now].slice(-20);
}

export function remainingSeconds(
  targetEpochMs: number,
  now: number = Date.now()
): number {
  if (!Number.isFinite(targetEpochMs) || targetEpochMs <= 0) return 0;
  return Math.max(0, Math.ceil((targetEpochMs - now) / 1000));
}

export interface AuthErrorInfo {
  code: string;
  messageKey: string;
  floodSeconds: number | null;
  isNetwork: boolean;
  suggestQr: boolean;
}

const KNOWN_ERROR_TOKENS = [
  "API_ID_PUBLISHED_FLOOD",
  "PHONE_NUMBER_BANNED",
  "PHONE_NUMBER_FLOOD",
  "PHONE_PASSWORD_FLOOD",
  "PHONE_NUMBER_INVALID",
  "PHONE_CODE_EXPIRED",
  "PHONE_CODE_INVALID",
  "PHONE_CODE_EMPTY",
  "PHONE_HASH_EXPIRED",
  "PASSWORD_HASH_INVALID",
  "PASSWORD_EMPTY",
  "SESSION_PASSWORD_NEEDED",
  "AUTH_RESTART",
  "AUTH_KEY_UNREGISTERED",
  "AUTH_KEY_INVALID",
  "SEND_CODE_UNAVAILABLE",
  "EMAIL_INVALID",
  "EMAIL_NOT_ALLOWED",
  "EMAIL_NOT_SETUP",
  "EMAIL_VERIFY_EXPIRED",
  "CODE_INVALID",
];

/**
 * Extracts a stable error code from GramJS / RPC errors.
 * FLOOD_WAIT_120 is normalised to FLOOD_WAIT so callers can use the seconds.
 */
export function getErrorCode(err: any): string {
  const msg: string =
    typeof err === "string"
      ? err
      : err?.errorMessage || err?.message || err?.error?.errorMessage || "";

  const upper = msg.toUpperCase();
  for (const token of KNOWN_ERROR_TOKENS) {
    if (upper.includes(token)) return token;
  }

  if (
    /FLOOD_WAIT[_\s]*\d+/i.test(msg) ||
    /A WAIT OF \d+ SECONDS? IS REQUIRED/i.test(msg)
  ) {
    return "FLOOD_WAIT";
  }

  if (/PHONE_MIGRATE_\d+/i.test(msg)) return "PHONE_MIGRATE";
  if (/NETWORK_MIGRATE_\d+/i.test(msg)) return "NETWORK_MIGRATE";
  if (/USER_MIGRATE_\d+/i.test(msg)) return "USER_MIGRATE";

  const networkPattern =
    /(network|timeout|timed out|fetch|socket|disconnect|econnreset|etimedout|enotfound|econnrefused|handshake)/i;
  if (networkPattern.test(msg)) return "NETWORK";

  return msg ? msg.slice(0, 80) : "UNKNOWN";
}

/**
 * Extracts the destination DC from PHONE_MIGRATE_X / NETWORK_MIGRATE_X /
 * USER_MIGRATE_X so auth calls can move to the account's home DC.
 */
export function getMigrateDc(err: any): number | null {
  const msg: string =
    typeof err === "string"
      ? err
      : err?.errorMessage || err?.message || err?.error?.errorMessage || "";
  const match = /(?:PHONE|NETWORK|USER)_MIGRATE_(\d+)/i.exec(msg);
  if (!match) return null;
  const dc = parseInt(match[1], 10);
  return Number.isFinite(dc) && dc > 0 ? dc : null;
}

export function classifyAuthError(err: any): AuthErrorInfo {
  const code = getErrorCode(err);
  const floodSeconds = parseFloodWaitSeconds(err);

  const base = {
    code,
    floodSeconds: null as number | null,
    isNetwork: false,
    suggestQr: false,
  };

  switch (code) {
    case "API_ID_PUBLISHED_FLOOD":
      return { ...base, messageKey: "errors.apiIdPublishedFlood" };
    case "PHONE_NUMBER_BANNED":
      return { ...base, messageKey: "errors.phoneNumberBanned", suggestQr: true };
    case "PHONE_NUMBER_FLOOD":
      return {
        ...base,
        messageKey: "errors.phoneNumberFlood",
        suggestQr: true,
      };
    case "PHONE_PASSWORD_FLOOD":
      return {
        ...base,
        messageKey: "errors.phonePasswordFlood",
        suggestQr: true,
      };
    case "PHONE_NUMBER_INVALID":
      return { ...base, messageKey: "errors.phoneNumberInvalid" };
    case "PHONE_CODE_EXPIRED":
    case "PHONE_HASH_EXPIRED":
      return { ...base, messageKey: "errors.codeExpired", suggestQr: true };
    case "PHONE_CODE_INVALID":
    case "PHONE_CODE_EMPTY":
      return { ...base, messageKey: "errors.invalidCode" };
    case "PASSWORD_HASH_INVALID":
      return { ...base, messageKey: "errors.incorrectPassword" };
    case "PASSWORD_EMPTY":
      return { ...base, messageKey: "errors.passwordEmpty" };
    case "SESSION_PASSWORD_NEEDED":
      return { ...base, messageKey: "errors.twoStepRequired" };
    case "AUTH_RESTART":
      return { ...base, messageKey: "errors.authRestart" };
    case "AUTH_KEY_UNREGISTERED":
    case "AUTH_KEY_INVALID":
      return { ...base, messageKey: "errors.sessionInvalid" };
    case "SEND_CODE_UNAVAILABLE":
      return {
        ...base,
        messageKey: "errors.sendCodeUnavailable",
        suggestQr: true,
      };
    case "EMAIL_INVALID":
      return { ...base, messageKey: "errors.emailInvalid" };
    case "EMAIL_NOT_ALLOWED":
    case "EMAIL_NOT_SETUP":
      return { ...base, messageKey: "errors.emailNotAllowed" };
    case "EMAIL_VERIFY_EXPIRED":
      return { ...base, messageKey: "errors.emailVerifyExpired" };
    case "CODE_INVALID":
      return { ...base, messageKey: "errors.emailCodeInvalid" };
    case "PHONE_MIGRATE":
    case "NETWORK_MIGRATE":
    case "USER_MIGRATE":
      return { ...base, messageKey: "errors.serverMigrate" };
    case "NETWORK":
      return { ...base, messageKey: "errors.networkError", isNetwork: true };
    case "FLOOD_WAIT":
      return {
        ...base,
        messageKey: floodSeconds
          ? "errors.floodWait"
          : "errors.floodWaitFewSeconds",
        floodSeconds,
        suggestQr: true,
      };
    default:
      return { ...base, messageKey: "errors.sendCodeFailed" };
  }
}

export function authErrorText(info: AuthErrorInfo, t: (key: string, opts?: any) => string): string {
  if (info.messageKey === "errors.floodWait" && info.floodSeconds) {
    return t(info.messageKey, { count: info.floodSeconds });
  }
  if (
    info.messageKey === "errors.tooManyCodeRequests" ||
    info.messageKey === "errors.phoneNumberFlood"
  ) {
    return t(info.messageKey, { count: info.floodSeconds ?? 0 });
  }
  return t(info.messageKey);
}

/** Masks a phone number while keeping the country prefix and last 4 digits. */
export function maskPhone(phone: string): string {
  const clean = (phone || "").replace(/[^\d+]/g, "");
  if (clean.length <= 4) return "****";
  const prefixLength = clean.startsWith("+") ? Math.min(3, clean.length - 4) : Math.min(2, clean.length - 4);
  return `${clean.slice(0, prefixLength)}****${clean.slice(-4)}`;
}

/** Masks an email address for display in the OTP screen. */
export function maskEmail(email: string): string {
  const clean = (email || "").trim();
  const at = clean.indexOf("@");
  if (at <= 0) return clean || "***";
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

export interface DiagnosticsInput {
  delivery: string;
  nextDelivery: string | null;
  timeoutSeconds: number;
  codeLength: number;
  phone: string;
  platform: string;
  appVersion: string;
  errorCode?: string | null;
}

/**
 * Builds a copy-pasteable diagnostic block. Never includes the login code,
 * the full phone number or the phone_code_hash.
 */
export function buildDiagnostics(input: DiagnosticsInput): string {
  return [
    "TeleDrive login diagnostics",
    `app: ${input.appVersion} (${input.platform})`,
    `phone: ${maskPhone(input.phone)}`,
    `delivery: ${input.delivery || "unknown"}`,
    `next: ${input.nextDelivery || "none"}`,
    `codeLength: ${input.codeLength > 0 ? input.codeLength : "unknown"}`,
    `timeout: ${input.timeoutSeconds > 0 ? `${input.timeoutSeconds}s` : "unknown"}`,
    `error: ${input.errorCode || "none"}`,
  ].join("\n");
}
