import { describe, expect, it } from "vitest";
import { displayEmail, initialsFromEmail } from "./userIdentity";

describe("initialsFromEmail", () => {
  it("falls back to a placeholder when there is no usable email", () => {
    expect(initialsFromEmail(undefined)).toBe("?");
    expect(initialsFromEmail("")).toBe("?");
    expect(initialsFromEmail("   ")).toBe("?");
  });

  it("takes the first letter of the first two segments", () => {
    expect(initialsFromEmail("frane.kuzmanic9@gmail.com")).toBe("FK");
  });

  it("treats underscores, hyphens and plus signs as segment separators", () => {
    expect(initialsFromEmail("a_b-c@x.hr")).toBe("AB");
    expect(initialsFromEmail("ana+payslips@x.hr")).toBe("AP");
  });

  it("takes the first two letters when the local part is one segment", () => {
    expect(initialsFromEmail("frane@x.hr")).toBe("FR");
  });

  it("returns a single letter when the local part is a single character", () => {
    expect(initialsFromEmail("f@x.hr")).toBe("F");
  });

  it("uppercases non-ASCII letters without throwing", () => {
    expect(initialsFromEmail("žarko.ćurić@x.hr")).toBe("ŽĆ");
  });

  it("falls back when nothing alphabetic survives", () => {
    expect(initialsFromEmail("123456@x.com")).toBe("?");
  });

  it("uses the whole string when there is no @", () => {
    expect(initialsFromEmail("frane.kuzmanic")).toBe("FK");
  });
});

describe("displayEmail", () => {
  it("returns the email when one exists", () => {
    expect(displayEmail("ana@x.hr", "Unknown")).toBe("ana@x.hr");
  });

  it("returns the supplied fallback when the session has no email", () => {
    expect(displayEmail(undefined, "Unknown")).toBe("Unknown");
    expect(displayEmail("  ", "Unknown")).toBe("Unknown");
  });
});
