import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SourceRegionsResponse } from "@payslip/shared";
import { getPayslipSource } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Spinner } from "../components/Spinner";
import { PdfSource } from "./PdfSource";
import { ZoomableSourceViewport, type RegionInteraction } from "./ZoomableSourceViewport";

export type { RegionInteraction };

interface SourceDocumentPanelProps {
  payslipId: string;
  regions: SourceRegionsResponse | null;
  activeField: string | null;
  interaction: RegionInteraction;
  fieldValues: Record<string, string>;
  lowConfidenceFields: readonly string[];
  editedFields: readonly string[];
  onSelect: (field: string) => void;
}

export function SourceDocumentPanel({
  payslipId,
  regions,
  activeField,
  interaction,
  fieldValues,
  lowConfidenceFields,
  editedFields,
  onSelect,
}: SourceDocumentPanelProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Awaited<ReturnType<typeof getPayslipSource>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retriedImage, setRetriedImage] = useState(false);
  // Set when pdf.js cannot render the document, which drops back to the browser's own viewer.
  const [pdfUnavailable, setPdfUnavailable] = useState(false);

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const next = await getPayslipSource(payslipId);
      setSource(next);
      setRetriedImage(false);
      setPdfUnavailable(false);
    } catch (error) {
      console.error("[review] could not load the source document", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [payslipId]);

  if (loading) return <Spinner />;
  if (failed || source === null)
    return <ErrorMessage message={t("review.errors.load")} onRetry={() => void load()} />;

  const isPdf = source.contentType === "application/pdf";
  const page = regions?.pages[0];

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="font-semibold">{t("review.sourceTitle")}</h2>
      {isPdf && pdfUnavailable ? (
        <>
          <object
            data={source.url}
            type="application/pdf"
            className="min-h-96 w-full rounded border border-slate-200"
          >
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center underline"
            >
              {t("review.openSource")}
            </a>
          </object>
          <p className="text-sm text-slate-600">{t("review.highlightsUnavailablePdf")}</p>
        </>
      ) : isPdf ? (
        <PdfSource
          url={source.url}
          regions={regions}
          activeField={activeField}
          interaction={interaction}
          fieldValues={fieldValues}
          lowConfidenceFields={lowConfidenceFields}
          editedFields={editedFields}
          onSelect={onSelect}
          onUnavailable={() => setPdfUnavailable(true)}
        />
      ) : (
        <ImageSource
          url={source.url}
          aspectRatio={page?.aspectRatio}
          regions={regions}
          activeField={activeField}
          interaction={interaction}
          fieldValues={fieldValues}
          lowConfidenceFields={lowConfidenceFields}
          editedFields={editedFields}
          onSelect={onSelect}
          onRetry={() => {
            if (!retriedImage) {
              setRetriedImage(true);
              void load();
            }
          }}
          alt={t("review.sourceAlt")}
        />
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center underline"
        >
          {t("review.openSource")}
        </a>
      </div>
    </section>
  );
}

interface ImageSourceProps {
  url: string;
  aspectRatio: number | undefined;
  regions: SourceRegionsResponse | null;
  activeField: string | null;
  interaction: RegionInteraction;
  fieldValues: Record<string, string>;
  lowConfidenceFields: readonly string[];
  editedFields: readonly string[];
  onSelect: (field: string) => void;
  onRetry: () => void;
  alt: string;
}

function ImageSource({
  url,
  aspectRatio,
  regions,
  activeField,
  interaction,
  fieldValues,
  lowConfidenceFields,
  editedFields,
  onSelect,
  onRetry,
  alt,
}: ImageSourceProps) {
  const [overlaySafe, setOverlaySafe] = useState(false);
  const page = regions?.pages[0];

  return (
    <ZoomableSourceViewport
      ratio={aspectRatio ?? 1}
      overlaySafe={overlaySafe && page !== undefined}
      regions={regions?.regions ?? []}
      page={page?.page ?? 1}
      activeField={activeField}
      interaction={interaction}
      fieldValues={fieldValues}
      lowConfidenceFields={lowConfidenceFields}
      editedFields={editedFields}
      onSelect={onSelect}
    >
      {() => (
        <img
          src={url}
          alt={alt}
          draggable={false}
          className="block size-full"
          onLoad={(event) => {
            const renderedRatio =
              event.currentTarget.naturalWidth / event.currentTarget.naturalHeight;
            setOverlaySafe(
              aspectRatio !== undefined && Math.abs(renderedRatio - aspectRatio) < 0.01,
            );
          }}
          onError={onRetry}
        />
      )}
    </ZoomableSourceViewport>
  );
}
