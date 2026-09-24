import type { ExtractionFailureReason, SourceContentType } from "@payslip/shared";

export interface ExtractionInput {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
}

export interface ExtractionFieldMetadata {
  readonly confidence: number | null;
  readonly source: "model" | "text" | "inferred";
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
  readonly fields: Record<string, ExtractionFieldMetadata>;
  readonly unreadableFields: string[];
}

export interface ProviderExtractionResult {
  /** Placeholder until Task 02's canonical payslip fields replace it. */
  readonly fields: Record<string, unknown>;
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
