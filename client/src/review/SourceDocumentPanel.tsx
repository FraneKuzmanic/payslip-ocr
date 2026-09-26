import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SourceRegionsResponse } from "@payslip/shared";
import { getPayslipSource } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Spinner } from "../components/Spinner";
import { PdfSource } from "./PdfSource";
import { SourceStrip } from "./SourceStrip";
import { ZoomableSourceViewport, type RegionInteraction } from "./ZoomableSourceViewport";

export type { RegionInteraction };

interface SourceDocumentPanelProps {
  payslipId: string;
  regions: SourceRegionsResponse | null;
  activeField: string | null;
  interaction: RegionInteraction;
  fieldValues: Record<string, string>;
  lowConfidenceFields: readonly string[];
  ungroundableFields: readonly string[];
  unreadableFields: readonly string[];
  editedFields: readonly string[];
  onSelect?: (field: string) => void;
  /** False where the page already names the document in its own heading (Task 08). */
  showTitle?: boolean;
  strip?: boolean;
}

export function SourceDocumentPanel({
  payslipId,
  regions,
  activeField,
  interaction,
  fieldValues,
  lowConfidenceFields,
  ungroundableFields,
  unreadableFields,
  editedFields,
  onSelect,
  showTitle = true,
  strip = false,
}: SourceDocumentPanelProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Awaited<ReturnType<typeof getPayslipSource>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retriedImage, setRetriedImage] = useState(false);
  // Set when pdf.js cannot render the document, which drops back to the browser's own viewer.
  const [pdfUnavailable, setPdfUnavailable] = useState(false);
  // Set when the image still fails after one fresh URL: the browser cannot decode it (HEIC outside
  // Safari, Task 07 D10), so the panel says so instead of showing a broken image.
  const [imageUnavailable, setImageUnavailable] = useState(false);

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const next = await getPayslipSource(payslipId);
      setSource(next);
      setPdfUnavailable(false);
    } catch (error) {
      console.error("[review] could not load the source document", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  // The one image retry is per payslip, not per load: resetting it on every load retried an
  // undecodable image forever, fetching a new signed URL each time.
  useEffect(() => {
    setRetriedImage(false);
    setImageUnavailable(false);
    void load();
  }, [payslipId]);

  if (loading) return <Spinner />;
  if (failed || source === null)
    return <ErrorMessage message={t("review.errors.load")} onRetry={() => void load()} />;

  const isPdf = source.contentType === "application/pdf";
  const page = regions?.pages[0];

  return (
    <section
      className={
        strip
          ? "pointer-events-none fixed inset-x-0 z-40 h-16 overflow-hidden border-b border-slate-200 bg-white"
          : "flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3"
      }
      style={strip ? { top: "var(--visual-top, 0px)" } : undefined}
    >
      {showTitle && !strip ? <h2 className="font-semibold">{t("review.sourceTitle")}</h2> : null}
      {isPdf && pdfUnavailable ? (
        strip ? (
          <p aria-hidden="true" className="px-3 text-sm text-slate-600">
            {t("review.stripNoOutline")}
          </p>
        ) : (
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
                className="inline-flex min-h-12 items-center underline"
              >
                {t("review.openSource")}
              </a>
            </object>
            <p className="text-sm text-slate-600">{t("review.highlightsUnavailablePdf")}</p>
          </>
        )
      ) : isPdf ? (
        <PdfSource
          strip={strip}
          url={source.url}
          regions={regions}
          activeField={activeField}
          interaction={interaction}
          fieldValues={fieldValues}
          lowConfidenceFields={lowConfidenceFields}
          ungroundableFields={ungroundableFields}
          unreadableFields={unreadableFields}
          editedFields={editedFields}
          onSelect={onSelect}
          onUnavailable={() => setPdfUnavailable(true)}
        />
      ) : imageUnavailable ? (
        <p aria-hidden={strip || undefined} className="text-sm text-slate-600">
          {t(strip ? "review.stripNoOutline" : "review.imageUnavailable")}
        </p>
      ) : (
        <ImageSource
          strip={strip}
          url={source.url}
          aspectRatio={page?.aspectRatio}
          regions={regions}
          activeField={activeField}
          interaction={interaction}
          fieldValues={fieldValues}
          lowConfidenceFields={lowConfidenceFields}
          ungroundableFields={ungroundableFields}
          unreadableFields={unreadableFields}
          editedFields={editedFields}
          onSelect={onSelect}
          onRetry={() => {
            // The first failure may be an expired signed URL, so it gets one fresh one.
            if (retriedImage) {
              console.error("[review] the browser could not display the source image");
              setImageUnavailable(true);
              return;
            }
            setRetriedImage(true);
            void load();
          }}
          alt={t("review.sourceAlt")}
        />
      )}
      {strip ? null : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center underline"
          >
            {t("review.openSource")}
          </a>
        </div>
      )}
    </section>
  );
}

interface ImageSourceProps {
  strip: boolean;
  url: string;
  aspectRatio: number | undefined;
  regions: SourceRegionsResponse | null;
  activeField: string | null;
  interaction: RegionInteraction;
  fieldValues: Record<string, string>;
  lowConfidenceFields: readonly string[];
  ungroundableFields: readonly string[];
  unreadableFields: readonly string[];
  editedFields: readonly string[];
  onSelect?: (field: string) => void;
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
  ungroundableFields,
  unreadableFields,
  editedFields,
  onSelect,
  onRetry,
  alt,
  strip,
}: ImageSourceProps) {
  // "pending" until the image has loaded, so the withheld note never flashes during load (D10).
  // Keyed on the URL it measured, so a new URL reads as "pending" in the same render. A reset
  // effect could run after an early `load` and discard its measurement.
  const [measured, setMeasured] = useState<{ url: string; ratio: "agrees" | "disagrees" }>();
  const ratio = measured?.url === url ? measured.ratio : "pending";
  const page = regions?.pages[0];

  function loaded(image: HTMLImageElement) {
    const renderedRatio = image.naturalWidth / image.naturalHeight;
    setMeasured({
      url,
      ratio:
        aspectRatio !== undefined && Math.abs(renderedRatio - aspectRatio) < 0.01
          ? "agrees"
          : "disagrees",
    });
  }

  if (strip)
    return (
      <>
        {/* A never-opened preview still needs its image measured before the strip may draw it. */}
        {ratio === "pending" ? (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            className="hidden"
            onLoad={(event) => loaded(event.currentTarget)}
            onError={onRetry}
          />
        ) : null}
        <SourceStrip
          ratio={aspectRatio ?? 1}
          overlaySafe={ratio === "agrees" && page !== undefined}
          regions={regions?.regions ?? []}
          page={1}
          activeField={activeField}
          editedFields={editedFields}
        >
          {(width) => (
            <img
              src={url}
              alt={alt}
              draggable={false}
              className="block size-full"
              style={{ width }}
              onLoad={(event) => loaded(event.currentTarget)}
              onError={onRetry}
            />
          )}
        </SourceStrip>
      </>
    );

  return (
    <ZoomableSourceViewport
      ratio={aspectRatio ?? 1}
      overlaySafe={ratio === "agrees" && page !== undefined}
      outlinesWithheld={
        ratio === "disagrees" && (regions?.regions.some((region) => region.page === 1) ?? false)
      }
      regions={regions?.regions ?? []}
      page={page?.page ?? 1}
      activeField={activeField}
      interaction={interaction}
      fieldValues={fieldValues}
      lowConfidenceFields={lowConfidenceFields}
      ungroundableFields={ungroundableFields}
      unreadableFields={unreadableFields}
      editedFields={editedFields}
      onSelect={onSelect}
    >
      {() => (
        <img
          src={url}
          alt={alt}
          draggable={false}
          className="block size-full"
          onLoad={(event) => loaded(event.currentTarget)}
          onError={onRetry}
        />
      )}
    </ZoomableSourceViewport>
  );
}
