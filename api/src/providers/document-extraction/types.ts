import type {
  CanonicalPayslipFields,
  ExtractionFailureReason,
  FieldMetadata,
  SourceContentType,
} from "@payslip/shared";

export interface ExtractionInput {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
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

  constructor(reason: ExtractionFailureReason, retryable: boolean, cause?: unknown) {
    super(reason, cause === undefined ? undefined : { cause });
    this.name = "ExtractionError";
    this.reason = reason;
    this.retryable = retryable;
  }
}

export interface DocumentExtractionProvider {
  extract(input: ExtractionInput): Promise<ProviderExtractionResult>;
}
