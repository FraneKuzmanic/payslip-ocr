import { describe, expect, it } from "vitest";
import type { CanonicalPayslipFields } from "@payslip/shared";
import { editedFields, liveSignals } from "./edited.js";

const original: CanonicalPayslipFields = {
  employerName: "Tvrtka d.o.o.",
  netoPlaca: "1500.00",
  obustave: [
    { naziv: "KREDIT", iznos: "100.00" },
    { naziv: "SINDIKAT", iznos: "10.00" },
    { naziv: "ULOG", iznos: "5.00" },
  ],
  payComponents: [{ naziv: "REDOVAN RAD", sati: "168.00", iznos: "1800.00" }],
};

describe("editedFields", () => {
  it("marks nothing on an unchanged payslip", () => {
    expect(editedFields(original, original)).toEqual([]);
  });

  it("marks nothing when there is no original to compare with", () => {
    expect(editedFields({ ...original, netoPlaca: "1.00" }, null)).toEqual([]);
  });

  it("marks a changed scalar, and clears it when the original is typed back", () => {
    const edited = { ...original, netoPlaca: "1500.01" };
    expect(editedFields(edited, original)).toEqual(["netoPlaca"]);
    expect(editedFields({ ...edited, netoPlaca: "1500.00" }, original)).toEqual([]);
  });

  it("treats a line break joined into a space as unchanged", () => {
    expect(
      editedFields(
        { ...original, obustave: [{ naziv: "SA SALDA", iznos: "1.00" }] },
        { ...original, obustave: [{ naziv: "SA\nSALDA", iznos: "1.00" }] },
      ),
    ).toEqual([]);
  });

  it("treats null, absent and blank as equal", () => {
    expect(
      editedFields({ ...original, employeeOib: "" }, { ...original, employeeOib: null }),
    ).toEqual([]);
  });

  it("counts a retyped decimal as an edit", () => {
    expect(editedFields({ ...original, netoPlaca: "1500.0" }, original)).toEqual(["netoPlaca"]);
  });

  it("marks only the one changed cell", () => {
    const obustave = original.obustave!.map((row, i) =>
      i === 1 ? { ...row, iznos: "11.00" } : row,
    );
    expect(editedFields({ ...original, obustave }, original)).toEqual(["obustave.1.iznos"]);
  });

  it("marks every cell of every row from a removed middle row down", () => {
    const obustave = [original.obustave![0]!, original.obustave![2]!];
    expect(editedFields({ ...original, obustave }, original)).toEqual([
      "obustave.1.naziv",
      "obustave.1.vjerovnik",
      "obustave.1.iznos",
      "obustave.1.ostatakSalda",
      "obustave.1.brojRata",
    ]);
  });

  it("marks only the appended row's cells", () => {
    const neoporeziviPrimici = [{ naziv: "PRIJEVOZ", iznos: "50.00" }];
    expect(
      editedFields(
        { ...original, neoporeziviPrimici, payComponents: [...original.payComponents!, {}] },
        { ...original, neoporeziviPrimici: [] },
      ),
    ).toEqual([
      "payComponents.1.naziv",
      "payComponents.1.sati",
      "payComponents.1.koeficijent",
      "payComponents.1.iznos",
      "neoporeziviPrimici.0.naziv",
      "neoporeziviPrimici.0.iznos",
    ]);
  });

  it("skips tables absent from both sides while the tables pass is outstanding", () => {
    const scalarsOnly = { employerName: "Tvrtka d.o.o.", netoPlaca: "1500.00" };
    expect(editedFields(scalarsOnly, scalarsOnly)).toEqual([]);
  });
});

describe("liveSignals", () => {
  const fields: CanonicalPayslipFields = { ...original, obustave: [original.obustave![0]!] };

  it("drops edited paths and paths to rows that no longer exist, and keeps the rest", () => {
    expect(
      liveSignals(
        [
          "netoPlaca",
          "employerName",
          "obustave.0.iznos",
          "obustave.2.iznos",
          "payComponents.0.sati",
        ],
        ["netoPlaca"],
        fields,
      ),
    ).toEqual(["employerName", "obustave.0.iznos", "payComponents.0.sati"]);
  });

  it("drops a table path when the table itself is absent", () => {
    expect(liveSignals(["neoporeziviPrimici.0.iznos"], [], fields)).toEqual([]);
  });
});
