import type { AdminMailbox, MailHealth } from "@/types/api";

/** Badge tones the shared `Badge` primitive offers. */
export type StatusTone = "success" | "warning" | "danger" | "neutral";

/** Dictionary keys under `adminMail.*` for each health state. */
const HEALTH_LABEL_KEY: Record<MailHealth, string> = {
  ok: "adminMail.statusOk",
  auth_failed: "adminMail.statusAuthFailed",
  unreachable: "adminMail.statusUnreachable",
  error: "adminMail.statusError",
  unknown: "adminMail.statusUnknown",
};

const HEALTH_TONE: Record<MailHealth, StatusTone> = {
  ok: "success",
  auth_failed: "danger",
  unreachable: "warning",
  error: "danger",
  unknown: "neutral",
};

/**
 * What to show for a mailbox's status. A mailbox that is not receiving
 * requests (account disabled, or switched off) says so first: its last health
 * result is stale and would only mislead.
 */
export function mailboxStatus(mailbox: AdminMailbox): {
  labelKey: string;
  tone: StatusTone;
} {
  if (!mailbox.user_is_active) {
    return { labelKey: "adminMail.statusAccountDisabled", tone: "warning" };
  }
  if (!mailbox.is_enabled) {
    return { labelKey: "adminMail.statusOff", tone: "neutral" };
  }
  return {
    labelKey: HEALTH_LABEL_KEY[mailbox.health_status],
    tone: HEALTH_TONE[mailbox.health_status],
  };
}

export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Common providers, so the usual settings are one choice instead of three fields. */
export const SMTP_PRESETS = [
  { id: "gmail", label: "Gmail", host: "smtp.gmail.com", port: 587, security: "starttls" },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    security: "starttls",
  },
] as const;

/**
 * Recognises the mail-server replies people actually run into, most specific
 * first, and names the dictionary entry that explains them in plain words.
 * Anything unrecognised falls back to a generic sentence; the server's own
 * words are always available next to it as technical details.
 */
const MAIL_ERROR_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/5\.7\.9|application-specific password|app password|InvalidSecondFactor/i, "adminMail.errAppPassword"],
  [
    /5\.7\.139|5\.7\.30|SmtpClientAuthentication|basic authentication is disabled|security defaults/i,
    "adminMail.errBasicAuthDisabled",
  ],
  [/must issue a STARTTLS|STARTTLS.*(required|first)/i, "adminMail.errStarttlsRequired"],
  [
    /\b535\b|5\.7\.8|not accepted|BadCredentials|authentication (failed|unsuccessful)|invalid credentials|incorrect password|password.*(expired|incorrect|invalid)/i,
    "adminMail.errBadCredentials",
  ],
  [
    /getaddrinfo|name or service not known|nodename nor servname|no address associated|name resolution|not known/i,
    "adminMail.errUnknownHost",
  ],
  [/refused|errno 111|10061|no route to host|network is unreachable/i, "adminMail.errRefused"],
  [/timed out|timeout/i, "adminMail.errTimeout"],
  [
    /connection lost|disconnected|reset by peer|unexpected eof|connection closed/i,
    "adminMail.errDisconnected",
  ],
  [/certificate|ssl|tls|wrong version number/i, "adminMail.errTls"],
];

export function mailErrorKey(raw: string | null | undefined): string {
  const text = raw ?? "";
  for (const [pattern, key] of MAIL_ERROR_PATTERNS) {
    if (pattern.test(text)) return key;
  }
  return "adminMail.errGeneric";
}

/**
 * The server's own wording, tidied for reading: SMTP replies arrive as a
 * Python tuple with literal "\n" and quote marks, which is noise.
 */
export function tidyMailError(raw: string): string {
  return raw
    .replace(/^\(\s*\d+\s*,\s*['"]/, (match) => match.match(/\d+/)?.[0] + " ")
    .replace(/['"]\s*\)\s*$/, "")
    .replaceAll("\\n", "\n")
    .trim();
}

export const SMTP_SECURITY_KEYS = {
  starttls: "adminMail.securityStarttls",
  ssl: "adminMail.securitySsl",
  none: "adminMail.securityNone",
} as const;
