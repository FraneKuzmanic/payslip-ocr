import {
  isRetryableFailure,
  type CanonicalPayslipFields,
  type ExtractionFailureReason,
  type FieldMetadata,
  type SourceContentType,
} from "@payslip/shared";

export interface ExtractionInput {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
  /** The whole-analysis budget; aborting it ends the extraction as `provider_unavailable`. */
  readonly signal: AbortSignal;
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
}

export interface ProviderExtractionResult {
  readonly fields: CanonicalPayslipFields;
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
