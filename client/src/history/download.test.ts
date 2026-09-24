import { afterEach, describe, expect, it, vi } from "vitest";
import { exportFilename, saveBlob } from "./download";

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
