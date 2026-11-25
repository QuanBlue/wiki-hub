import { api } from "@/lib/api-client";
import type {
  LoginResponse,
  TwoFactorConfirmResponse,
  TwoFactorRecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorStatus,
  User,
} from "@/types/api";

export function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  return api.get<TwoFactorStatus>("/api/v1/auth/2fa/status");
}

export function setupTwoFactor(
  challengeToken?: string,
): Promise<TwoFactorSetupResponse> {
  return api.post<TwoFactorSetupResponse>(
    "/api/v1/auth/2fa/setup",
    challengeToken ? { challenge_token: challengeToken } : {},
  );
}

export function confirmTwoFactor(
  code: string,
  challengeToken?: string,
): Promise<TwoFactorConfirmResponse> {
  return api.post<TwoFactorConfirmResponse>(
    "/api/v1/auth/2fa/confirm",
    challengeToken ? { code, challenge_token: challengeToken } : { code },
  );
}

export function verifyTwoFactor(
  challengeToken: string,
  code: string,
): Promise<LoginResponse> {
  return api.post<LoginResponse>("/api/v1/auth/2fa/verify", {
    challenge_token: challengeToken,
    code,
  });
}

export function disableTwoFactor(
  password: string,
  code: string,
): Promise<TwoFactorStatus> {
  return api.post<TwoFactorStatus>("/api/v1/auth/2fa/disable", {
    password,
    code,
  });
}

export function reconfigureTwoFactor(
  password: string,
  code: string,
): Promise<TwoFactorSetupResponse> {
  return api.post<TwoFactorSetupResponse>("/api/v1/auth/2fa/reconfigure", {
    password,
    code,
  });
}

export function regenerateRecoveryCodes(
  password: string,
  code: string,
): Promise<TwoFactorRecoveryCodesResponse> {
  return api.post<TwoFactorRecoveryCodesResponse>(
    "/api/v1/auth/2fa/recovery-codes/regenerate",
    { password, code },
  );
}

export function resetUserTwoFactor(userId: string): Promise<User> {
  return api.post<User>(`/api/v1/users/${userId}/reset-2fa`);
}

export function formatRecoveryCodesText(
  codes: string[],
  siteName = "WikiHub",
): string {
  return [
    `${siteName} — Two-Factor Authentication Recovery Codes`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Each recovery code can be used only once. Store these codes in a safe place.",
    "",
    ...codes,
    "",
  ].join("\n");
}

export function downloadRecoveryCodes(
  codes: string[],
  siteName = "WikiHub",
): void {
  const content = formatRecoveryCodesText(codes, siteName);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "wikihub-recovery-codes.txt";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
