import { afterEach, describe, expect, it, vi } from "vitest";
import { exportFilename, payslipExportFilename, saveBlob } from "./download";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("download helpers", () => {
  it("builds stable export filenames", () => {
    const now = new Date("2026-08-20T14:30:00.000Z");

    expect(exportFilename("csv", now)).toBe("payslips-2026-08-20.csv");
    expect(exportFilename("json", now)).toBe("payslips-2026-08-20.json");
  });

  it("names one payslip's file by its period and short id, never by a name", () => {
    const id = "a1b2c3d4-0000-4000-8000-000000000000";

    expect(payslipExportFilename({ id, period: "2025-06" }, "csv")).toBe(
      "payslip-2025-06-a1b2c3d4.csv",
    );
    expect(payslipExportFilename({ id, period: null }, "json")).toBe("payslip-a1b2c3d4.json");
    expect(payslipExportFilename({ id }, "json")).toBe("payslip-a1b2c3d4.json");
  });

  it("saves a blob through an object URL and revokes it", () => {
    const createObjectURL = vi.fn(() => "blob:payslip-export");
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const blob = new Blob(["id,total"], { type: "text/csv" });
    saveBlob(blob, "payslips-2026-08-20.csv");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:payslip-export");
    expect(document.querySelector("a")).toBeNull();
  });
});
