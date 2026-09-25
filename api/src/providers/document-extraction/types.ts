import {
  isRetryableFailure,
  type CanonicalPayslipFields,
  type ExtractionFailureReason,
  type FieldMetadata,
  type SourceContentType,
} from "@payslip/shared";

/**
 * Extraction runs as two passes over the same document (Task 05): `scalars` returns the scalar
 * fields and makes the form usable; `tables` returns the three line-item tables.
 */
export const EXTRACTION_PASSES = ["scalars", "tables"] as const;
export type ExtractionPass = (typeof EXTRACTION_PASSES)[number];

export interface ExtractionInput {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
  /** The whole-analysis budget; aborting it ends the extraction as `provider_unavailable`. */
  readonly signal: AbortSignal;
  readonly pass: ExtractionPass;
}

export interface ExtractionMetadata {
  readonly provider: string;
  readonly modelId: string;
  readonly apiVersion: string;
  readonly analyzedAt: string;
  readonly latencyMs: number;
  readonly uploadMs?: number;
  readonly analyzeMs?: number;
  readonly documentConfidence: number | null;
  /** Keyed by canonical dotted path (`netoPlaca`, `payComponents.2.iznos`). */
  readonly fields: Record<string, FieldMetadata>;
  readonly unreadableFields: string[];
  /** Submits made before one was accepted; above 1 a duplicate analysis may have been billed. */
  readonly submitAttempts?: number;
  /**
   * Time the pass waited in the runner's queue before the provider was called. Set by the runner,
   * never by the provider; a user waits through it too.
   */
  readonly queuedMs?: number;
}

export interface ProviderExtractionResult {
  /** Only the pass's own canonical keys; the other pass's keys are absent, never empty. */
  readonly fields: Partial<CanonicalPayslipFields>;
  readonly metadata: ExtractionMetadata;
  /** Provider response retained verbatim for debugging. */
  readonly raw: unknown;
}

export class ExtractionError extends Error {
  readonly retryable: boolean;
  readonly reason: ExtractionFailureReason;

  constructor(reason: ExtractionFailureReason, cause?: unknown) {
    super(reason, cause === undefined ? undefined : { cause });
    this.name = "ExtractionError";
    this.reason = reason;
    // Derived, never passed: retryability is a function of the reason (PRD §7.4).
    this.retryable = isRetryableFailure(reason);
  }
}

export interface DocumentExtractionProvider {
  extract(input: ExtractionInput): Promise<ProviderExtractionResult>;
}
