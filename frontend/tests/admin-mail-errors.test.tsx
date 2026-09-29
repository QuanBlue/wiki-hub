import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MailError } from "@/components/admin/mail-error";
import { mailErrorKey, tidyMailError } from "@/lib/admin-mail-ui";

// What Gmail really answers when a normal password is used.
const GMAIL_APP_PASSWORD =
  "(534, '5.7.9 Application-specific password required. For more information, go to\\n5.7.9 https://support.google.com/mail/?p=InvalidSecondFactor d9443c01a7336-2df91401161sm40956965ad.36 - gsmtp')";

describe("mailErrorKey", () => {
  it.each([
    [GMAIL_APP_PASSWORD, "adminMail.errAppPassword"],
    ["(535, '5.7.8 Username and Password not accepted. BadCredentials')", "adminMail.errBadCredentials"],
    [
      "(535, '5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant.')",
      "adminMail.errBasicAuthDisabled",
    ],
    ["(530, 'Must issue a STARTTLS command first')", "adminMail.errStarttlsRequired"],
    ["[Errno 11001] getaddrinfo failed", "adminMail.errUnknownHost"],
    ["[Errno 111] Connect call failed ('127.0.0.1', 25)", "adminMail.errRefused"],
    ["Timed out connecting to smtp.example.com on port 587", "adminMail.errTimeout"],
    ["Connection lost", "adminMail.errDisconnected"],
    ["[SSL: WRONG_VERSION_NUMBER] wrong version number", "adminMail.errTls"],
    ["something nobody has seen before", "adminMail.errGeneric"],
    [null, "adminMail.errGeneric"],
  ])("explains %j", (raw, key) => {
    expect(mailErrorKey(raw)).toBe(key);
  });

  it("does not mistake an app-password reply for a plain wrong password", () => {
    expect(mailErrorKey(GMAIL_APP_PASSWORD)).not.toBe("adminMail.errBadCredentials");
  });
});

describe("tidyMailError", () => {
  it("unwraps the reply tuple and turns escaped line breaks into real ones", () => {
    const tidy = tidyMailError(GMAIL_APP_PASSWORD);

    expect(tidy.startsWith("534 5.7.9 Application-specific password required.")).toBe(true);
    expect(tidy).toContain("go to\n5.7.9 https://support.google.com");
    expect(tidy).not.toMatch(/^\(|\)$|\\n/);
  });
});

describe("MailError", () => {
  it("says what to do first and keeps the server's words folded underneath", () => {
    render(<MailError raw={GMAIL_APP_PASSWORD} />);

    expect(screen.getByText(/Gmail needs an app password here/)).toBeInTheDocument();
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    expect(screen.getByText(/Application-specific password required/)).toBeInTheDocument();
    // The raw Python tuple is not what people are shown.
    expect(screen.queryByText(/^\(534,/)).toBeNull();
  });

  it("has no details section when there is nothing to show", () => {
    render(<MailError raw={null} />);

    expect(screen.getByText(/mail server reported a problem/)).toBeInTheDocument();
    expect(screen.queryByText("Technical details")).toBeNull();
  });
});
