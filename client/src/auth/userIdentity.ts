/**
 * Two-letter avatar initials from an email address. There is no name in the system — sign-up
 * collects email and password only — so the local part is all we have to work with.
 */
export function initialsFromEmail(email: string | undefined): string {
  const trimmed = email?.trim() ?? "";
  if (trimmed === "") return "?";

  const atIndex = trimmed.indexOf("@");
  const localPart = atIndex === -1 ? trimmed : trimmed.slice(0, atIndex);

  // Separators and digit runs both mark a word boundary: `frane.kuzmanic9` is two words, not three.
  const segments = localPart.split(/[._+\-\d]+/).filter((segment) => segment !== "");
  if (segments.length === 0) return "?";

  if (segments.length >= 2) {
    return `${segments[0]!.slice(0, 1)}${segments[1]!.slice(0, 1)}`.toUpperCase();
  }

  return segments[0]!.slice(0, 2).toUpperCase();
}

/** The email, or a translated fallback the caller supplies when the session has no email. */
export function displayEmail(email: string | undefined, fallback: string): string {
  const trimmed = email?.trim() ?? "";
  return trimmed === "" ? fallback : trimmed;
}
