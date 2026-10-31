import { describe, it, expect } from "vitest";
import {
  MAX_CODE_REQUESTS_PER_HOUR,
  PENDING_CODE_TTL_MS,
  authErrorText,
  buildDiagnostics,
  checkCodeRequestBudget,
  classNameOf,
  classifyAuthError,
  getErrorCode,
  getMigrateDc,
  isEmailVerifiedLogin,
  isPendingUsable,
  isSentCodeSuccess,
  maskEmail,
  maskPhone,
  parseSentCode,
  pendingFromSentCode,
  pruneRequestTimes,
  recordRequestTime,
  remainingSeconds,
} from "../loginFlow";

function fakeT(key: string, opts?: any): string {
  return opts ? `${key}:${JSON.stringify(opts)}` : key;
}

describe("constructor-name detection", () => {
  it("normalises short class names and preserves fully-qualified ones", () => {
    expect(classNameOf({ className: "LoginTokenSuccess" })).toBe(
      "auth.LoginTokenSuccess"
    );
    expect(classNameOf({ className: "auth.LoginTokenSuccess" })).toBe(
      "auth.LoginTokenSuccess"
    );
    expect(classNameOf({ className: "account.EmailVerifiedLogin" })).toBe(
      "account.EmailVerifiedLogin"
    );
    expect(classNameOf({ className: "UpdateLoginToken" })).toBe(
      "auth.UpdateLoginToken"
    );
    expect(classNameOf(null)).toBe("");
  });

  it("detects account email verification results", () => {
    expect(
      isEmailVerifiedLogin({ className: "account.EmailVerifiedLogin" })
    ).toBe(true);
    expect(isEmailVerifiedLogin({ className: "auth.SentCodeSuccess" })).toBe(
      false
    );
  });
});

describe("parseSentCode", () => {
  it("maps an app code and its SMS fallback", () => {
    const info = parseSentCode({
      type: { className: "auth.SentCodeTypeApp", length: 5 },
      phoneCodeHash: "hash-1",
      nextType: { className: "auth.CodeTypeSms" },
      timeout: 30,
    });

    expect(info).not.toBeNull();
    expect(info!.delivery).toBe("app");
    expect(info!.codeLength).toBe(5);
    expect(info!.phoneCodeHash).toBe("hash-1");
    expect(info!.nextDelivery).toBe("sms");
    expect(info!.timeoutSeconds).toBe(30);
  });

  it("maps email codes with pattern and reset metadata", () => {
    const info = parseSentCode({
      type: {
        className: "auth.SentCodeTypeEmailCode",
        length: 6,
        emailPattern: "jo***@example.com",
        resetAvailablePeriod: 3600,
        resetPendingDate: 1700000000,
      },
      phoneCodeHash: "hash-2",
      timeout: 60,
    });

    expect(info!.delivery).toBe("email");
    expect(info!.codeLength).toBe(6);
    expect(info!.emailPattern).toBe("jo***@example.com");
    expect(info!.resetAvailablePeriod).toBe(3600);
    expect(info!.resetPendingDate).toBe(1700000000);
  });

  it("maps the email setup requirement and fragment URLs", () => {
    const setup = parseSentCode({
      type: { className: "auth.SentCodeTypeSetUpEmailRequired" },
      phoneCodeHash: "hash-3",
      timeout: 60,
    });
    expect(setup!.delivery).toBe("emailSetup");
    expect(setup!.codeLength).toBe(0);

    const fragment = parseSentCode({
      type: {
        className: "auth.SentCodeTypeFragmentSms",
        url: "https://fragment.com/code",
        length: 6,
      },
      phoneCodeHash: "hash-4",
      timeout: 60,
    });
    expect(fragment!.delivery).toBe("fragment");
    expect(fragment!.fragmentUrl).toBe("https://fragment.com/code");
  });

  it("returns null for SentCodeSuccess and non-SentCode results", () => {
    expect(isSentCodeSuccess({ className: "auth.SentCodeSuccess" })).toBe(true);
    expect(parseSentCode({ className: "auth.SentCodeSuccess" })).toBeNull();
    expect(parseSentCode(null)).toBeNull();
  });

  it("uses a safe default resend timeout when Telegram omits it", () => {
    const info = parseSentCode({
      type: { className: "auth.SentCodeTypeSms", length: 5 },
      phoneCodeHash: "hash-5",
    });
    expect(info!.timeoutSeconds).toBe(60);
  });
});

describe("pending login cooldown and persistence shape", () => {
  const now = 1_700_000_000_000;

  it("computes resend and expiry timestamps", () => {
    const info = parseSentCode({
      type: { className: "auth.SentCodeTypeApp", length: 5 },
      phoneCodeHash: "hash",
      nextType: { className: "auth.CodeTypeCall" },
      timeout: 45,
    })!;

    const pending = pendingFromSentCode("+911234567890", info, "temp-session", now);
    expect(pending.resendAt).toBe(now + 45_000);
    expect(pending.expiresAt).toBe(now + PENDING_CODE_TTL_MS);
    expect(pending.floodUntil).toBe(0);
    expect(pending.tempSession).toBe("temp-session");
    expect(pending.nextDelivery).toBe("call");
  });

  it("treats a pending code as usable only before expiry and with a hash or 2FA state", () => {
    const info = parseSentCode({
      type: { className: "auth.SentCodeTypeSms", length: 5 },
      phoneCodeHash: "hash",
      timeout: 60,
    })!;
    const pending = pendingFromSentCode("+911234567890", info, "temp", now);

    expect(isPendingUsable(pending, now + 1000)).toBe(true);
    expect(isPendingUsable(pending, pending.expiresAt)).toBe(false);
    expect(isPendingUsable({ ...pending, phoneCodeHash: "" }, now)).toBe(false);
    expect(
      isPendingUsable({ ...pending, phoneCodeHash: "", requiresPassword: true }, now)
    ).toBe(true);
  });

  it("enforces three code requests per rolling hour", () => {
    const times = [now - 3000, now - 2000, now - 1000];
    const blocked = checkCodeRequestBudget(times, now);

    expect(MAX_CODE_REQUESTS_PER_HOUR).toBe(3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.used).toBe(3);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(3500);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(3600);

    const allowed = checkCodeRequestBudget([now - 1000], now);
    expect(allowed.allowed).toBe(true);
    expect(allowed.retryAfterSeconds).toBe(0);
  });

  it("prunes request history older than one hour", () => {
    const times = [now - 3_700_000, now - 1000];
    expect(pruneRequestTimes(times, now)).toEqual([now - 1000]);
    expect(recordRequestTime([], now)).toEqual([now]);
  });

  it("counts down against wall-clock timestamps", () => {
    expect(remainingSeconds(now + 5000, now)).toBe(5);
    expect(remainingSeconds(now, now)).toBe(0);
    expect(remainingSeconds(now - 5000, now)).toBe(0);
  });
});

describe("auth error classification", () => {
  it("normalises FLOOD_WAIT variants and keeps the seconds", () => {
    expect(getErrorCode(new Error("FLOOD_WAIT_120"))).toBe("FLOOD_WAIT");
    const info = classifyAuthError(new Error("FLOOD_WAIT_120"));
    expect(info.messageKey).toBe("errors.floodWait");
    expect(info.floodSeconds).toBe(120);
    expect(authErrorText(info, fakeT)).toBe(
      'errors.floodWait:{"count":120}'
    );
  });

  it("does not confuse published API IDs or phone floods with a normal flood wait", () => {
    expect(getErrorCode(new Error("API_ID_PUBLISHED_FLOOD"))).toBe(
      "API_ID_PUBLISHED_FLOOD"
    );
    expect(classifyAuthError(new Error("API_ID_PUBLISHED_FLOOD")).messageKey).toBe(
      "errors.apiIdPublishedFlood"
    );
    expect(getErrorCode(new Error("PHONE_NUMBER_FLOOD"))).toBe(
      "PHONE_NUMBER_FLOOD"
    );
    expect(classifyAuthError(new Error("PHONE_NUMBER_FLOOD")).messageKey).toBe(
      "errors.phoneNumberFlood"
    );
    expect(getErrorCode(new Error("PHONE_PASSWORD_FLOOD"))).toBe(
      "PHONE_PASSWORD_FLOOD"
    );
  });

  it("maps code, email and network errors to friendly keys", () => {
    expect(classifyAuthError(new Error("SEND_CODE_UNAVAILABLE")).messageKey).toBe(
      "errors.sendCodeUnavailable"
    );
    expect(classifyAuthError(new Error("PHONE_CODE_EXPIRED")).messageKey).toBe(
      "errors.codeExpired"
    );
    expect(classifyAuthError(new Error("PHONE_CODE_INVALID")).messageKey).toBe(
      "errors.invalidCode"
    );
    expect(classifyAuthError(new Error("EMAIL_INVALID")).messageKey).toBe(
      "errors.emailInvalid"
    );
    expect(classifyAuthError(new Error("EMAIL_VERIFY_EXPIRED")).messageKey).toBe(
      "errors.emailVerifyExpired"
    );
    expect(classifyAuthError(new Error("Network request failed")).messageKey).toBe(
      "errors.networkError"
    );
  });
});

describe("DC migration", () => {
  it("extracts the destination DC from migration errors", () => {
    expect(getMigrateDc(new Error("PHONE_MIGRATE_4"))).toBe(4);
    expect(getMigrateDc({ errorMessage: "NETWORK_MIGRATE_2" })).toBe(2);
    expect(getMigrateDc("USER_MIGRATE_5")).toBe(5);
    expect(getMigrateDc(new Error("FLOOD_WAIT_30"))).toBeNull();
    expect(getMigrateDc(new Error("PHONE_MIGRATE_0"))).toBeNull();
    expect(getMigrateDc(null)).toBeNull();
  });
});

describe("diagnostics privacy", () => {
  it("masks phone and email values", () => {
    expect(maskPhone("+911234567890")).toBe("+91****7890");
    expect(maskPhone("1234")).toBe("****");
    expect(maskEmail("johndoe@example.com")).toBe("jo***@example.com");
  });

  it("builds a block without the full phone number or code", () => {
    const text = buildDiagnostics({
      delivery: "app",
      nextDelivery: "sms",
      timeoutSeconds: 30,
      codeLength: 5,
      phone: "+911234567890",
      platform: "android",
      appVersion: "0.1.3",
      errorCode: "FLOOD_WAIT",
    });

    expect(text).toContain("phone: +91****7890");
    expect(text).toContain("delivery: app");
    expect(text).toContain("next: sms");
    expect(text).toContain("error: FLOOD_WAIT");
    expect(text).not.toContain("+911234567890");
    expect(text).not.toContain("123456");
  });
});
