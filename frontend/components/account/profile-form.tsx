"use client";

import { Link2, Loader2, Trash2, Upload, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import type { Me, User } from "@/types/api";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const SOCIAL_SLOTS = 2;

function initials(name: string, username: string): string {
  return (name.trim() || username)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function normalizeSocialLinks(links: string[]) {
  return [...links.slice(0, SOCIAL_SLOTS), ...Array(SOCIAL_SLOTS).fill("")].slice(0, SOCIAL_SLOTS);
}

export function ProfileForm({ user, onCancel, onSaved }: { user: Me; onCancel: () => void; onSaved: () => void }) {
  const router = useRouter();
  const fileInputId = useId();
  const { t, apiErrorText } = useTranslation();
  const [fullName, setFullName] = useState(user.full_name);
  const [email, setEmail] = useState(user.email);
  const [bio, setBio] = useState(user.bio);
  const [pronouns, setPronouns] = useState(user.pronouns || "unspecified");
  const [profileUrl, setProfileUrl] = useState(user.profile_url);
  const [socialLinks, setSocialLinks] = useState(() => normalizeSocialLinks(user.social_links));
  const [company, setCompany] = useState(user.company);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const displayAvatar = previewUrl || (!avatarRemoved ? avatarUrl : "");

  function chooseFile(file: File | undefined) {
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      setError(t("profile.invalidImageType"));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(t("profile.avatarTooLarge"));
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setError(null);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setAvatarRemoved(false);
  }

  function removeAvatar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSelectedFile(null);
    setAvatarUrl("");
    setAvatarRemoved(true);
  }

  function updateSocialLink(index: number, value: string) {
    setSocialLinks((links) => links.map((link, currentIndex) => currentIndex === index ? value : link));
  }

  function validateUrl(value: string, label: string): string | null {
    if (!value.trim()) return null;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:"
        ? null
        : t("profile.urlMustStartHttp", { label });
    } catch {
      return t("profile.invalidUrl", { label });
    }
  }

  function getValidationErrors(): Record<string, string> {
    const nextErrors: Record<string, string> = {};
    const name = fullName.trim();
    const normalizedEmail = email.trim();

    if (!name) nextErrors.fullName = t("profile.enterDisplayName");
    else if (name.length > 255) nextErrors.fullName = t("profile.displayNameTooLong");
    if (!normalizedEmail) nextErrors.email = t("profile.enterEmail");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) nextErrors.email = t("profile.invalidEmail");
    if (bio.length > 500) nextErrors.bio = t("profile.bioTooLong");
    if (company.trim().length > 255) nextErrors.company = t("profile.companyTooLong");

    const websiteError = validateUrl(profileUrl, t("profile.websiteLabel"));
    if (websiteError) nextErrors.profileUrl = websiteError;
    socialLinks.forEach((link, index) => {
      const linkError = validateUrl(link, t("profile.socialLinkLabel", { index: index + 1 }));
      if (linkError) nextErrors[`social-${index}`] = linkError;
    });

    return nextErrors;
  }

  function validateField(field: string) {
    const nextErrors = getValidationErrors();
    setFieldErrors((current) => {
      const updated = { ...current };
      if (nextErrors[field]) updated[field] = nextErrors[field];
      else delete updated[field];
      return updated;
    });
  }

  function validateForm(): boolean {
    const nextErrors = getValidationErrors();
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateForm()) return;
    setPending(true);
    setError(null);
    try {
      const profile = {
        full_name: fullName.trim(),
        email: email.trim(),
        bio: bio.trim(),
        pronouns: pronouns === "unspecified" ? "" : pronouns,
        profile_url: profileUrl.trim() || null,
        social_links: socialLinks.map((link) => link.trim()).filter(Boolean),
        company: company.trim(),
      };
      await api.patch<User>("/api/v1/users/me", profile);
      if (selectedFile) {
        const body = new FormData();
        body.append("file", selectedFile);
        await api.post<User>("/api/v1/users/me/avatar", undefined, { rawBody: body });
      } else if (avatarRemoved) {
        await api.delete<User>("/api/v1/users/me/avatar");
      }
      toast.success(t("profile.profileUpdated"));
      onSaved();
      router.refresh();
    } catch (err) {
      setError(apiErrorText(err, "profile.couldNotUpdateProfile"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full" noValidate>
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="max-w-2xl space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">{t("profile.displayName")}</Label>
            <Input id="profile-name" value={fullName} onChange={(event) => setFullName(event.target.value)} onBlur={() => validateField("fullName")} disabled={pending} aria-invalid={Boolean(fieldErrors.fullName)} maxLength={255} />
            <p className="text-muted-foreground text-xs">{t("profile.displayNameHint")}</p>
            {fieldErrors.fullName ? <p className="text-danger text-xs">{fieldErrors.fullName}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-email">{t("profile.email")}</Label>
            <Input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => validateField("email")} disabled={pending} aria-invalid={Boolean(fieldErrors.email)} required />
            {fieldErrors.email ? <p className="text-danger text-xs">{fieldErrors.email}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-bio">{t("profile.bio")}</Label>
            <Textarea id="profile-bio" value={bio} onChange={(event) => setBio(event.target.value)} onBlur={() => validateField("bio")} disabled={pending} aria-invalid={Boolean(fieldErrors.bio)} maxLength={500} placeholder={t("profile.bioPlaceholder")} />
            <p className="text-muted-foreground text-xs">{bio.length}/500</p>
            {fieldErrors.bio ? <p className="text-danger text-xs">{fieldErrors.bio}</p> : null}
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("profile.pronouns")}</Label>
              <Select value={pronouns} onValueChange={setPronouns} disabled={pending}>
                <SelectTrigger aria-label={t("profile.pronounsAria")}><SelectValue /></SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="unspecified">{t("profile.pronounsUnspecified")}</SelectItem>
                  <SelectItem value="she/her">She/her</SelectItem>
                  <SelectItem value="he/him">He/him</SelectItem>
                  <SelectItem value="they/them">They/them</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-company">{t("profile.company")}</Label>
              <Input id="profile-company" value={company} onChange={(event) => setCompany(event.target.value)} onBlur={() => validateField("company")} disabled={pending} aria-invalid={Boolean(fieldErrors.company)} maxLength={255} placeholder={t("profile.companyPlaceholder")} />
              {fieldErrors.company ? <p className="text-danger text-xs">{fieldErrors.company}</p> : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-url">{t("profile.website")}</Label>
            <Input id="profile-url" type="url" value={profileUrl} onChange={(event) => setProfileUrl(event.target.value)} onBlur={() => validateField("profileUrl")} disabled={pending} aria-invalid={Boolean(fieldErrors.profileUrl)} placeholder="https://example.com" />
            {fieldErrors.profileUrl ? <p className="text-danger text-xs">{fieldErrors.profileUrl}</p> : null}
          </div>

          <div className="space-y-2">
            <div><Label>{t("profile.socialLinks")}</Label><p className="text-muted-foreground mt-1 text-xs">{t("profile.socialLinksHint")}</p></div>
            <div className="space-y-2">
              {socialLinks.map((link, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1"><Input aria-label={t("profile.socialLinkLabel", { index: index + 1 })} type="url" value={link} onChange={(event) => updateSocialLink(index, event.target.value)} onBlur={() => validateField(`social-${index}`)} disabled={pending} aria-invalid={Boolean(fieldErrors[`social-${index}`])} placeholder={t("profile.socialLinkPlaceholder", { index: index + 1 })} />{fieldErrors[`social-${index}`] ? <p className="text-danger mt-1 text-xs">{fieldErrors[`social-${index}`]}</p> : null}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="border-border bg-surface-sunken/60 flex flex-col items-center rounded-lg border p-5 text-center">
          <Label className="self-start">{t("profile.profilePicture")}</Label>
          <span aria-hidden className="bg-primary text-primary-foreground mt-4 flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-full text-3xl font-semibold shadow-sm ring-1 ring-border">
            {displayAvatar ? <img src={displayAvatar} alt="" className="size-full object-cover" /> : initials(fullName, user.username) || <UserRound className="size-10" />}
          </span>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => document.getElementById(fileInputId)?.click()}><Upload />{t("profile.change")}</Button>
            {displayAvatar ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={removeAvatar}><Trash2 />{t("profile.remove")}</Button> : null}
          </div>
          <p className="text-muted-foreground mt-3 text-xs">{t("profile.avatarTypes")}</p>
          <input id={fileInputId} type="file" accept={AVATAR_TYPES.join(",")} className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} disabled={pending} />
        </aside>
      </div>

      {error ? <p role="alert" className="border-danger/30 bg-danger/10 text-danger mt-6 rounded-md border px-3 py-2 text-sm">{error}</p> : null}
      <footer className="border-border mt-8 flex flex-wrap justify-end gap-2 border-t pt-5"><Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>{t("profile.cancel")}</Button><Button type="submit" variant="primary" disabled={pending || !email.trim()}>{pending ? <Loader2 className="animate-spin" /> : null}{t("profile.saveChanges")}</Button></footer>
    </form>
  );
}
