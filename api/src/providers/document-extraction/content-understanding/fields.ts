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
  /** Every canonical key present; tables are `[]` when absent. */
  readonly fields: CanonicalPayslipFields;
  readonly fieldMetadata: Record<string, FieldMetadata>;
  readonly unreadableFields: string[];
  /** Whether the document's markdown carries any text at all. */
  readonly hasText: boolean;
}

/** Returns `null` when the body does not have the shape the mapper reads. */
export function mapAnalyzeResult(operation: unknown): MappedExtraction | null {
  const parsed = operationSchema.safeParse(operation);
  if (!parsed.success) return null;

  const [content] = parsed.data.result.contents;
  const rawFields = content?.fields ?? {};
  const fieldMetadata: Record<string, FieldMetadata> = {};
  const unreadableFields: string[] = [];

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
    return value;
  };

  const fields: Record<string, unknown> = {};
  for (const [name, parse] of Object.entries(SCALAR_PARSERS)) {
    fields[name] = read(name, rawFields[name], parse);
  }
  for (const [table, columns] of Object.entries(TABLE_PARSERS)) {
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
    hasText: (content?.markdown ?? "").trim() !== "",
  };
}
