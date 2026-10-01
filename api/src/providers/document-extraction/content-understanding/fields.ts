import { z } from "zod";
import {
  addAmounts,
  amountsEqual,
  canonicalPayslipFieldsSchema,
  parseAmount,
  parseDate,
  parsePeriod,
  parseQuantity,
  subtractAmounts,
  type CanonicalPayslipFields,
  type FieldMetadata,
} from "@payslip/shared";
import type { ExtractionPass } from "../types.js";
import { SCALAR_PARTS, roleFields } from "./analyzer.js";
import { UNGROUNDABLE_BY_DESIGN, isGrounded, keyPages, surfaceForms } from "./grounding.js";
import { storedRows, type RowOrder } from "./row-order.js";

/**
 * The only place Content Understanding's field names and value shapes meet the canonical model
 * (PRD §6.2). CU returns what the page prints (`2.298,97`, `svibanj 2025.`); normalising it is
 * this mapper's job (ROADMAP locked decision 13), with the shared parsers and nothing else.
 */

type Parser = (raw: string) => string | null;

/** Trim only. Croatian knowledge belongs in the field descriptions, not here (ROADMAP §5). */
const text: Parser = (raw) => raw.trim() || null;

type TableKey = "payComponents" | "obustave" | "neoporeziviPrimici";
type ScalarKey = Exclude<keyof CanonicalPayslipFields, TableKey>;

/** Parser per canonical scalar (Task 02 D1). `currency` is not here: the envelope is always EUR. */
const SCALAR_PARSERS: Record<ScalarKey, Parser> = {
  employerName: text,
  employerAddress: text,
  employerOib: text,
  employerIban: text,
  employeeName: text,
  employeeAddress: text,
  employeeOib: text,
  employeeIban: text,
  period: parsePeriod,
  paymentDate: parseDate,
  ukupnoSati: parseQuantity,
  brutoPlaca: parseAmount,
  doprinosiIzPlace: parseAmount,
  doprinosMioIStup: parseAmount,
  doprinosMioIiStup: parseAmount,
  dohodak: parseAmount,
  osobniOdbitak: parseAmount,
  poreznaOsnovica: parseAmount,
  porezNaDohodak: parseAmount,
  netoPlaca: parseAmount,
  neoporeziviPrimiciUkupno: parseAmount,
  obustaveUkupno: parseAmount,
  iznosZaIsplatu: parseAmount,
  doprinosiNaPlacu: parseAmount,
  ukupanTrosakRada: parseAmount,
};

const TABLE_PARSERS: Record<TableKey, Record<string, Parser>> = {
  payComponents: {
    naziv: text,
    sati: parseQuantity,
    koeficijent: parseQuantity,
    iznos: parseAmount,
  },
  // `brojRata` stays text: A01 prints instalments as `10/120`.
  obustave: {
    naziv: text,
    vjerovnik: text,
    iznos: parseAmount,
    ostatakSalda: parseAmount,
    brojRata: text,
  },
  neoporeziviPrimici: { naziv: text, iznos: parseAmount },
};

/** The canonical scalars the mapper reads, in schema order (Task 08 D6). */
export const SCALAR_FIELDS = Object.keys(SCALAR_PARSERS) as ScalarKey[];
/** Each line-item table's columns (Task 08 D6). */
export const TABLE_COLUMNS = Object.fromEntries(
  Object.entries(TABLE_PARSERS).map(([table, columns]) => [table, Object.keys(columns)]),
) as Record<TableKey, string[]>;

// Narrow views of exactly what is read. `.loose()` keeps the rest of the body out of the way.
const rawValueSchema = z
  .object({
    valueString: z.string().optional(),
    confidence: z.number().optional(),
    source: z.string().optional(),
  })
  .loose();

const rawFieldSchema = rawValueSchema.extend({
  valueArray: z
    .array(z.object({ valueObject: z.record(z.string(), rawValueSchema).optional() }).loose())
    .optional(),
});

const operationSchema = z
  .object({
    result: z
      .object({
        contents: z
          .array(
            z
              .object({
                markdown: z.string().optional(),
                fields: z.record(z.string(), rawFieldSchema).optional(),
                pages: z
                  .array(
                    z
                      .object({
                        words: z.array(z.object({ content: z.string() }).loose()).optional(),
                      })
                      .loose(),
                  )
                  .optional(),
              })
              .loose(),
          )
          .min(1),
      })
      .loose(),
  })
  .loose();

type RawValue = z.infer<typeof rawValueSchema>;

export interface MappedExtraction {
  /**
   * The mapped pass's canonical keys, every one present; tables are `[]` when absent. The other
   * pass's keys are absent, never `null` or `[]`, so merging one pass never erases the other.
   */
  readonly fields: Partial<CanonicalPayslipFields>;
  readonly fieldMetadata: Record<string, FieldMetadata>;
  readonly unreadableFields: string[];
  /**
   * Paths whose printed value is not among the page's OCR words: a likely invented value
   * (ROADMAP locked decision 16). Independent of `unreadableFields`.
   */
  readonly ungroundableFields: string[];
  /** Whether the document's markdown carries any text at all. */
  readonly hasText: boolean;
}

/**
 * Returns `null` when the body does not have the shape the mapper reads. `pass` limits the mapping
 * to that pass's keys (Task 05); without it every key is mapped, which only the scoring harness
 * uses, for single-pass recordings. Table rows are mapped in printed order (Task 17 D13);
 * `returned` re-maps a payslip stored before that, whose rows are in the service's order.
 * `totalRow` is the pay-component row to leave out, as `findTotalRow` gives it (Task 17 D14).
 */
export function mapAnalyzeResult(
  operation: unknown,
  pass?: ExtractionPass,
  rowOrder: RowOrder = "printed",
  totalRow: number | null = null,
): MappedExtraction | null {
  const parsed = operationSchema.safeParse(operation);
  if (!parsed.success) return null;

  const [content] = parsed.data.result.contents;
  const rawFields = content?.fields ?? {};
  const fieldMetadata: Record<string, FieldMetadata> = {};
  const unreadableFields: string[] = [];
  const ungroundableFields: string[] = [];
  // Each pass OCRs the whole document, so it is grounded against its own words (Task 06 D8).
  // Real bodies always carry pages; one without them grounds nothing.
  const pageKeys = keyPages(
    (content?.pages ?? []).map((page) => (page.words ?? []).map((word) => word.content)),
  );

  /**
   * A present, non-blank value the parser cannot normalise is unreadable: `null`, and listed, so
   * "could not read this" stays distinct from "not on the document" (PRD §6.4).
   */
  const read = (path: string, raw: RawValue | undefined, parse: Parser): string | null => {
    const printed = raw?.valueString;
    if (printed === undefined || printed.trim() === "") return null;
    fieldMetadata[path] = { confidence: raw?.confidence ?? null, source: "model" };
    const value = parse(printed);
    if (value === null) unreadableFields.push(path);
    // An unreadable value is still grounded, by its printed text: the two signals are independent.
    const forms = value === null ? [printed] : [printed, ...surfaceForms(value)];
    if (!UNGROUNDABLE_BY_DESIGN.includes(path) && !isGrounded(forms, pageKeys)) {
      ungroundableFields.push(path);
    }
    return value;
  };

  const fields: Record<string, unknown> = {};
  const scalarParsers: Record<string, Parser> = pass === "tables" ? {} : SCALAR_PARSERS;
  const tableParsers: Record<string, Record<string, Parser>> = pass === "scalars"
    ? {}
    : TABLE_PARSERS;
  for (const [name, parse] of Object.entries(scalarParsers)) {
    fields[name] = read(name, rawFields[name], parse);
  }
  for (const [table, columns] of Object.entries(tableParsers)) {
    // Absent and printed-empty tables both come back without `valueArray`; the golden set records
    // both as `[]`. The null-versus-zero distinction lives on the totals, not the tables.
    const rows = storedRows(table, rawFields[table]?.valueArray ?? [], rowOrder, totalRow);
    fields[table] = rows.map((row, index) =>
      Object.fromEntries(
        Object.entries(columns).map(([column, parse]) => [
          column,
          read(`${table}.${index}.${column}`, row.valueObject?.[column], parse),
        ]),
      ),
    );
  }

  return {
    fields: canonicalPayslipFieldsSchema.parse(fields),
    fieldMetadata,
    unreadableFields,
    ungroundableFields,
    hasText: (content?.markdown ?? "").trim() !== "",
  };
}

/**
 * The pay-component row that repeats the payslip's total instead of being a component (Task 17
 * D14): its amount is `brutoPlaca`, and the other rows already sum to `brutoPlaca`. The service
 * returns such a row on some runs of one document (F01's `PLAĆA (BRUTO SVOTA)`, in 4 of 10
 * recorded sets) although the field description asks for leaf rows only. The test is the
 * payslip's own arithmetic, to the cent, and reads no label. An index into the rows as returned,
 * or `null`.
 */
export function findTotalRow(tablesBody: unknown, brutoPlaca: string | null): number | null {
  const parsed = operationSchema.safeParse(tablesBody);
  if (!parsed.success || brutoPlaca === null) return null;

  const rows = parsed.data.result.contents[0]?.fields?.["payComponents"]?.valueArray ?? [];
  const amounts = rows.map((row) => parseAmount(row.valueObject?.["iznos"]?.valueString));
  const sum = amounts.reduce<string>((total, amount) => addAmounts(total, amount ?? "0"), "0");
  const index = amounts.findIndex(
    (amount) =>
      amount !== null &&
      amountsEqual(amount, brutoPlaca) &&
      amountsEqual(subtractAmounts(sum, amount), brutoPlaca),
  );
  return index === -1 ? null : index;
}

/**
 * The retained scalars pass as the bodies it was analysed in, each with the scalars it owns
 * (Task 17 D9): `{ header, reconciliation }` since the split, or one body owning every scalar
 * before it. `null` for anything else.
 */
export function scalarPartBodies(
  retained: unknown,
): { body: unknown; fields: readonly string[] }[] | null {
  if (typeof retained !== "object" || retained === null) return null;
  if ("result" in retained) return [{ body: retained, fields: SCALAR_FIELDS }];
  const parts = retained as Record<string, unknown>;
  if (!SCALAR_PARTS.every((part) => parts[part] !== undefined)) return null;
  return SCALAR_PARTS.map((part) => ({ body: parts[part], fields: Object.keys(roleFields(part)) }));
}

/**
 * A retained pass through the mapper, whichever shape it was stored in (Task 17 D5, D9). Each
 * part of the scalars pass contributes only the scalars it owns, with their metadata and paths, so
 * every scalar is present exactly once. `null` when any body does not map.
 */
export function mapRetainedPass(
  retained: unknown,
  pass: ExtractionPass,
  rowOrder: RowOrder = "printed",
  totalRow: number | null = null,
): MappedExtraction | null {
  if (pass === "tables") return mapAnalyzeResult(retained, "tables", rowOrder, totalRow);
  const parts = scalarPartBodies(retained);
  if (parts === null) return null;

  const fields: Record<string, unknown> = {};
  const fieldMetadata: Record<string, FieldMetadata> = {};
  const unreadableFields: string[] = [];
  const ungroundableFields: string[] = [];
  let hasText = false;
  for (const { body, fields: owned } of parts) {
    const mapped = mapAnalyzeResult(body, "scalars");
    if (mapped === null) return null;
    const values: Record<string, unknown> = mapped.fields;
    for (const name of owned) {
      fields[name] = values[name];
      const metadata = mapped.fieldMetadata[name];
      if (metadata !== undefined) fieldMetadata[name] = metadata;
    }
    unreadableFields.push(...mapped.unreadableFields.filter((path) => owned.includes(path)));
    ungroundableFields.push(...mapped.ungroundableFields.filter((path) => owned.includes(path)));
    hasText ||= mapped.hasText;
  }

  return {
    fields: canonicalPayslipFieldsSchema.parse(fields),
    fieldMetadata,
    unreadableFields,
    ungroundableFields,
    hasText,
  };
}
