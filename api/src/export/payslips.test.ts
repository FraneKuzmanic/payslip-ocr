import { readFileSync, readdirSync } from "node:fs";
import {
  canonicalPayslipFieldsSchema,
  jsonExportResponseSchema,
  type CanonicalPayslipFields,
  type Payslip,
} from "@payslip/shared";
import { describe, expect, it } from "vitest";
import { TABLES, scoreSet } from "../scoring/score.js";
import {
  CSV_COLUMNS,
  DECIMAL_COLUMNS,
  ISO_COLUMNS,
  SCALAR_COLUMNS,
  TEXT_COLUMNS,
  toCsv,
  toJsonExport,
} from "./payslips.js";

const FIXTURE_DIRECTORY = new URL("../../../.agents/fixtures/expected/", import.meta.url);
const CANONICAL_KEYS = Object.keys(canonicalPayslipFieldsSchema.shape);

const fixtureFiles = readdirSync(FIXTURE_DIRECTORY).filter((name) => name.endsWith(".json"));

function readFixture(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(file, FIXTURE_DIRECTORY), "utf8")) as Record<
    string,
    unknown
  >;
}

/** A golden-set fixture's canonical fields, without the keys it carries about itself. */
function canonicalFields(raw: Record<string, unknown>): CanonicalPayslipFields {
  return canonicalPayslipFieldsSchema.parse(
    Object.fromEntries(CANONICAL_KEYS.map((key) => [key, raw[key]])),
  );
}

const ENVELOPE = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000003",
  status: "confirmed",
  tablesStatus: "ready",
  pageCount: 1,
  currency: "EUR",
  warnings: [],
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:05:00.000Z",
  confirmedAt: "2026-09-25T10:10:00.000Z",
  deletedAt: null,
} as const satisfies Partial<Payslip>;

const payslip: Payslip = {
  ...ENVELOPE,
  employerName: "Primjer d.o.o.",
  employeeName: "Ivan Horvat",
  employeeOib: "12345678903",
  period: "2025-06",
  paymentDate: "2025-07-10",
  ukupnoSati: "176.000",
  brutoPlaca: "2298.97",
  iznosZaIsplatu: "1772.15",
  payComponents: [{ naziv: "REDOVAN RAD", sati: "176.000", koeficijent: null, iznos: "2298.97" }],
  obustave: [],
  neoporeziviPrimici: [],
};

/** The CSV's data rows, split into fields; none of the tests' values need quoting unless noted. */
function lines(csv: string): string[] {
  return csv.slice(1).split("\r\n");
}

function field(csv: string, column: (typeof CSV_COLUMNS)[number], row = 1): string | undefined {
  return lines(csv)[row]?.split(";")[CSV_COLUMNS.indexOf(column)];
}

describe("CSV export (plan 12 D1, D2)", () => {
  it("starts with the BOM and joins rows with CRLF, without a trailing break", () => {
    const csv = toCsv([payslip, payslip]);

    expect(csv.at(0)).toBe("\uFEFF");
    expect(lines(csv)).toHaveLength(3);
    expect(csv.slice(1)).not.toMatch(/[^\r]\n/);
    expect(csv.endsWith("\r\n")).toBe(false);
  });

  it("heads the file with the canonical identifiers in D2 order", () => {
    const header = lines(toCsv([]))[0];

    expect(header).toBe(CSV_COLUMNS.join(";"));
    expect(header).toMatch(/^id;sessionId;status;tablesStatus;currency;pageCount;employerName;/);
    expect(header).toMatch(/;confirmedAt;createdAt;updatedAt$/);
    expect(CSV_COLUMNS.slice(6, -3)).toEqual(SCALAR_COLUMNS);
  });

  it("puts every canonical scalar in exactly one column class", () => {
    expect(SCALAR_COLUMNS).toHaveLength(25);
    for (const column of SCALAR_COLUMNS) {
      const classes = [TEXT_COLUMNS, DECIMAL_COLUMNS, ISO_COLUMNS].filter((set) => set.has(column));
      expect(classes, column).toHaveLength(1);
    }
    expect(DECIMAL_COLUMNS.size).toBe(15);
  });

  it.each([
    ["2298.97", "2298,97"],
    ["-12.50", "-12,50"],
    ["176.000", "176,000"],
    ["600", "600"],
  ])("writes decimal %s as %s", (value, written) => {
    expect(field(toCsv([{ ...payslip, brutoPlaca: value }]), "brutoPlaca")).toBe(written);
  });

  it("writes hours with a decimal comma", () => {
    expect(field(toCsv([payslip]), "ukupnoSati")).toBe("176,000");
  });

  it("keeps dates ISO and structure columns raw", () => {
    const csv = toCsv([{ ...payslip, pageCount: 2, tablesStatus: "failed" }]);

    expect(field(csv, "period")).toBe("2025-06");
    expect(field(csv, "paymentDate")).toBe("2025-07-10");
    expect(field(csv, "pageCount")).toBe("2");
    expect(field(csv, "tablesStatus")).toBe("failed");
    expect(field(csv, "createdAt")).toBe("2026-09-25T10:00:00.000Z");
  });

  it("writes null and absent values as empty fields", () => {
    const csv = toCsv([{ ...payslip, employerName: null, dohodak: undefined }]);

    expect(field(csv, "employerName")).toBe("");
    expect(field(csv, "dohodak")).toBe("");
  });

  it("quotes a separator, a quote and a line break, but not a comma", () => {
    const csv = toCsv([
      {
        ...payslip,
        employerName: "Ivić; d.o.o.",
        employerAddress: 'Say "hi"',
        employeeAddress: "Ulica 1\nZagreb",
        employeeName: "Horvat, Ivan",
      },
    ]);

    expect(csv).toContain(';"Ivić; d.o.o.";');
    expect(csv).toContain(';"Say ""hi""";');
    expect(csv).toContain(';"Ulica 1\nZagreb";');
    expect(csv).toContain(";Horvat, Ivan;");
  });

  it.each(["=SUM(A1)", "+plus", "-minus", "@at", "\ttab", "\rcarriage", "\nline", "＝wide", "-"])(
    "neutralises text value %j",
    (employerName) => {
      expect(toCsv([{ ...payslip, employerName }])).toContain(`'${employerName}`);
    },
  );

  it("never neutralises a negative decimal", () => {
    const csv = toCsv([{ ...payslip, obustaveUkupno: "-0.50" }]);

    expect(field(csv, "obustaveUkupno")).toBe("-0,50");
    expect(csv).not.toContain("'-0");
  });

  it("passes Croatian diacritics through unchanged", () => {
    const name = "č ć ž š đ Č Ć Ž Š Đ";
    expect(field(toCsv([{ ...payslip, employeeName: name }]), "employeeName")).toBe(name);
  });

  it("leaves warnings and the line-item tables out", () => {
    const csv = toCsv([{ ...payslip, warnings: [{ code: "neto_mismatch", field: "netoPlaca" }] }]);

    expect(csv).not.toContain("neto_mismatch");
    expect(csv).not.toContain("REDOVAN RAD");
  });
});

describe("JSON export", () => {
  it("carries schemaVersion, tablesStatus and all three tables, without userId or deletedAt", () => {
    const [exported] = toJsonExport([payslip]).payslips;
    const body = toJsonExport([payslip]);

    expect(body.schemaVersion).toBe(1);
    expect(exported).not.toHaveProperty("userId");
    expect(exported).not.toHaveProperty("deletedAt");
    expect(exported?.tablesStatus).toBe("ready");
    expect(exported?.payComponents).toEqual(payslip.payComponents);
    expect(exported).toHaveProperty("obustave", []);
    expect(exported).toHaveProperty("neoporeziviPrimici", []);
  });

  it("keeps canonical decimal strings", () => {
    expect(toJsonExport([payslip]).payslips[0]?.brutoPlaca).toBe("2298.97");
  });

  it("throws on a key the export does not declare", () => {
    expect(() => toJsonExport([{ ...payslip, stray: true } as Payslip])).toThrow();
  });
});

/**
 * PRD §11.2 / ROADMAP Task 12 DoD (plan 12 D3): a JSON export re-imported into the scoring harness
 * reproduces the same values. Every golden fixture goes out through the real export, back through
 * the file's schema, and is scored against itself.
 */
describe("JSON export round trip through the scoring harness", () => {
  it("covers the whole golden set", () => {
    expect(fixtureFiles).toHaveLength(11);
  });

  const samples = fixtureFiles.map((file) => {
    const raw = readFixture(file);
    return { sample: file.replace(/\.json$/, ""), raw, fields: canonicalFields(raw) };
  });

  const parsed = jsonExportResponseSchema.parse(
    JSON.parse(
      JSON.stringify(toJsonExport(samples.map(({ fields }) => ({ ...ENVELOPE, ...fields })))),
    ),
  );

  it.each(samples.map((sample, index) => [sample.sample, index] as const))(
    "%s re-imports with identical canonical fields",
    (_sample, index) => {
      const exported = parsed.payslips[index];
      expect(exported).toBeDefined();
      expect(canonicalFields(exported as Record<string, unknown>)).toEqual(samples[index]?.fields);
    },
  );

  it("scores 100% on scalars, critical fields and every table's cells", () => {
    const report = scoreSet(
      samples.map(({ sample, raw }, index) => ({
        sample,
        expected: raw,
        actual: canonicalFields(parsed.payslips[index] as Record<string, unknown>),
        latencyMs: null,
      })),
    );

    expect(report.scalars.total).toBeGreaterThan(0);
    expect(report.scalars.hit).toBe(report.scalars.total);
    expect(report.critical.hit).toBe(report.critical.total);
    for (const table of TABLES) {
      expect(report.tables[table].cells.hit, table).toBe(report.tables[table].cells.total);
    }
  });
});
