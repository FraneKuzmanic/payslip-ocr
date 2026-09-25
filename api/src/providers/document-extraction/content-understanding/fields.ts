import { z } from "zod";
import {
  canonicalPayslipFieldsSchema,
  parseAmount,
  parseDate,
  parsePeriod,
  parseQuantity,
  type CanonicalPayslipFields,
  type FieldMetadata,
} from "@payslip/shared";
import type { ExtractionPass } from "../types.js";
import { UNGROUNDABLE_BY_DESIGN, isGrounded, keyPages, surfaceForms } from "./grounding.js";

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
  .object({ valueString: z.string().optional(), confidence: z.number().optional() })
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
 * uses, for single-pass recordings.
 */
export function mapAnalyzeResult(
  operation: unknown,
  pass?: ExtractionPass,
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
    const rows = rawFields[table]?.valueArray ?? [];
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
