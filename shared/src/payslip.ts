import { z } from "zod";
import { PERIOD_PATTERN } from "./datetime.js";
import { AMOUNT_PATTERN } from "./money.js";
import { payslipStatusSchema, tablesStatusSchema } from "./session.js";
import { payslipWarningSchema } from "./warnings.js";

/**
 * Money, hours and coefficients cross this boundary already normalised to a plain decimal
 * string; the printed `1.234,56` form never reaches the model (PRD §6.4). Money is read by
 * `parseAmount`; hours and coefficients by `parseQuantity`, because they print three decimals
 * (`1,000`) where money never does.
 */
const decimalSchema = z.string().regex(AMOUNT_PATTERN);

const optionalText = z.string().nullable().optional();
const optionalDecimal = decimalSchema.nullable().optional();

/** One row of the earnings breakdown that sums to `brutoPlaca`. */
export const payComponentSchema = z
  .object({
    naziv: optionalText,
    /** Hours, read by `parseQuantity`. */
    sati: optionalDecimal,
    /** Coefficient, read by `parseQuantity`: printed to three decimals (`0,135`). */
    koeficijent: optionalDecimal,
    iznos: optionalDecimal,
  })
  .strict();

export type PayComponent = z.infer<typeof payComponentSchema>;

/** An amount withheld from the payout for a third party — not a tax allowance. */
export const obustavaSchema = z
  .object({
    naziv: optionalText,
    vjerovnik: optionalText,
    iznos: optionalDecimal,
    ostatakSalda: optionalDecimal,
    /** Text, not a number: A01 prints instalments as `10/120`. */
    brojRata: optionalText,
  })
  .strict();

export type Obustava = z.infer<typeof obustavaSchema>;

/** A non-taxable payment added after `netoPlaca` — prehrana, prijevoz, putni nalozi. */
export const neoporeziviPrimitakSchema = z
  .object({
    naziv: optionalText,
    iznos: optionalDecimal,
  })
  .strict();

export type NeoporeziviPrimitak = z.infer<typeof neoporeziviPrimitakSchema>;

/**
 * Tier 1 — everything the user may edit in the review form, from PRD §6.4. Identifiers are
 * Croatian for payroll concepts that do not survive translation and English for structure, and
 * they never change with the UI language (see CONTEXT.md for each Croatian term).
 *
 * Every field is optional and nullable: no field is on every payslip, and a missing value stays
 * missing rather than being defaulted. `null` and `"0.00"` are different and both deliberate —
 * a printed `0,00` is `"0.00"`, a section absent from the page is `null`.
 */
export const canonicalPayslipFieldsSchema = z
  .object({
    // --- parties ---
    // No OIB or IBAN format rule: C01 prints a non-IBAN in its IBAN field, and a misread OIB
    // must stay visible and editable. The checksum is a warning, not a schema rejection.
    employerName: optionalText,
    employerAddress: optionalText,
    employerOib: optionalText,
    employerIban: optionalText,
    employeeName: optionalText,
    employeeAddress: optionalText,
    employeeOib: optionalText,
    employeeIban: optionalText,

    // --- period ---
    period: z.string().regex(PERIOD_PATTERN).nullable().optional(),
    paymentDate: z.iso.date().nullable().optional(),
    /** Total hours, read by `parseQuantity`. */
    ukupnoSati: optionalDecimal,

    // --- the reconciliation chain ---
    brutoPlaca: optionalDecimal,
    /** Employee-side contributions withheld from `brutoPlaca` (MIO I. + II. stup). */
    doprinosiIzPlace: optionalDecimal,
    doprinosMioIStup: optionalDecimal,
    doprinosMioIiStup: optionalDecimal,
    /** `brutoPlaca − doprinosiIzPlace`. Not "income". */
    dohodak: optionalDecimal,
    /** The personal tax allowance — not an obustava. */
    osobniOdbitak: optionalDecimal,
    /** `dohodak − osobniOdbitak`, floored at zero. */
    poreznaOsnovica: optionalDecimal,
    porezNaDohodak: optionalDecimal,
    /** `dohodak − porezNaDohodak`: earned after tax, before additions and obustave. */
    netoPlaca: optionalDecimal,
    neoporeziviPrimiciUkupno: optionalDecimal,
    obustaveUkupno: optionalDecimal,
    /** What reaches the bank account, and the only figure matching the bank statement. */
    iznosZaIsplatu: optionalDecimal,

    // --- employer side ---
    /** Employer-side contributions paid on top of `brutoPlaca`; never reduces the employee's pay. */
    doprinosiNaPlacu: optionalDecimal,
    ukupanTrosakRada: optionalDecimal,

    // --- line items ---
    payComponents: z.array(payComponentSchema).nullable().optional(),
    obustave: z.array(obustavaSchema).nullable().optional(),
    neoporeziviPrimici: z.array(neoporeziviPrimitakSchema).nullable().optional(),
  })
  .strict();

export type CanonicalPayslipFields = z.infer<typeof canonicalPayslipFieldsSchema>;

/**
 * The seven fields that raise `missing_critical_field` and carry the headline accuracy score
 * (PRD §6.5). `iznosZaIsplatu` is here because it is the bank-statement figure.
 */
export const CRITICAL_FIELDS = [
  "employerName",
  "employeeName",
  "employeeOib",
  "period",
  "brutoPlaca",
  "netoPlaca",
  "iznosZaIsplatu",
] as const satisfies readonly (keyof CanonicalPayslipFields)[];

/**
 * Tier 2 — tier 1 plus the envelope only the server may set.
 *
 * The split is the point. Because the PATCH body is derived from tier 1 alone, it is
 * structurally incapable of accepting `userId`, `status` or `currency`, so "never trust a
 * client-supplied userId" (PRD §9.1) is a property of the type system rather than a rule someone
 * has to remember. Do not flatten these into one schema.
 *
 * `currency` is envelope rather than an editable field because it is always EUR (ROADMAP locked
 * decision 7).
 */
export const payslipSchema = canonicalPayslipFieldsSchema.extend({
  id: z.uuid(),
  sessionId: z.uuid(),
  userId: z.uuid(),
  status: payslipStatusSchema,
  tablesStatus: tablesStatusSchema,
  pageCount: z.number().int().min(1),
  currency: z.literal("EUR"),
  warnings: z.array(payslipWarningSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable().optional(),
  deletedAt: z.iso.datetime().nullable().optional(),
});

export type Payslip = z.infer<typeof payslipSchema>;

/** `model`: returned by the extractor; `text`: re-grounded on page text; `inferred`: derived. */
export const FIELD_SOURCES = ["model", "text", "inferred"] as const;

/**
 * Provider-neutral metadata for one extracted value, keyed by canonical dotted path
 * (`netoPlaca`, `payComponents.2.iznos`). Stored with the payslip and never sent to the client
 * raw: the detail response exposes only its projections (`lowConfidenceFields`,
 * `unreadableFields`).
 */
export const fieldMetadataSchema = z
  .object({
    confidence: z.number().min(0).max(1).nullable(),
    source: z.enum(FIELD_SOURCES),
  })
  .strict();

export type FieldMetadata = z.infer<typeof fieldMetadataSchema>;
