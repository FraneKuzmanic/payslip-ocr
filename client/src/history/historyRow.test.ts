import i18n from "i18next";
import { describe, expect, it } from "vitest";
import "../i18n";
import { rowAmount, rowPeriod, rowRoute, rowTitle } from "./historyRow";

describe.each(["hr", "en"] as const)("history row helpers in %s", (language) => {
  const t = i18n.getFixedT(language);

  it("names a row by its employee, then its file, then the untitled copy", () => {
    expect(rowTitle({ employeeName: "Ana Horvat", originalFilename: "a.pdf" }, t)).toBe(
      "Ana Horvat",
    );
    expect(rowTitle({ employeeName: null, originalFilename: "a.pdf" }, t)).toBe("a.pdf");
    expect(rowTitle({ employeeName: null }, t)).toBe(t("history.untitled"));
    expect(t("history.untitled")).not.toBe("history.untitled");
  });

  it("returns null for an unread period and amount", () => {
    expect(rowPeriod({ period: null }, language)).toBeNull();
    expect(rowAmount({ iznosZaIsplatu: null }, language)).toBeNull();
    expect(rowAmount({}, language)).toBeNull();
  });
});

describe("history row formatting", () => {
  it("shows the period in the UI language's form", () => {
    expect(rowPeriod({ period: "2025-06" }, "hr")).toBe("06/2025");
    expect(rowPeriod({ period: "2025-06" }, "en")).toBe("2025-06");
  });

  it("shows iznos za isplatu as euros in the UI language", () => {
    expect(rowAmount({ iznosZaIsplatu: "1772.15" }, "hr")).toBe("1.772,15\u00a0€");
    expect(rowAmount({ iznosZaIsplatu: "1772.15" }, "en")).toBe("€1,772.15");
  });

  it("links into the row's session, on that payslip", () => {
    expect(rowRoute({ id: "p/1", sessionId: "s 1" })).toBe("/sessions/s%201?payslip=p%2F1");
  });
});
