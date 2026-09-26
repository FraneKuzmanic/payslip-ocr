import { FileImage } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getPayslipSource } from "../api/client";
import { Skeleton } from "../components/Skeleton";
import { PageThumbnail } from "../review/PageNavigator";
import { loadPdfDocument, type LoadedPdf } from "../review/pdfDocument";

type Thumbnail =
  | { kind: "loading" }
  | { kind: "image"; url: string }
  | { kind: "pdf"; document: LoadedPdf }
  | { kind: "unavailable" };

/** A payslip's first page, small, for the merge dialog (plan 11 D12). Decorative: its card names it. */
export function SourceThumbnail({ payslipId }: { payslipId: string }) {
  const { t } = useTranslation();
  const [thumbnail, setThumbnail] = useState<Thumbnail>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let loaded: LoadedPdf | undefined;
    setThumbnail({ kind: "loading" });

    void (async () => {
      try {
        const source = await getPayslipSource(payslipId);
        if (controller.signal.aborted) return;
        if (source.contentType !== "application/pdf") {
          setThumbnail({ kind: "image", url: source.url });
          return;
        }
        const document = await loadPdfDocument(source.url, controller.signal);
        if (controller.signal.aborted) {
          document.destroy();
          return;
        }
        loaded = document;
        setThumbnail({ kind: "pdf", document });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[merge] could not load a source thumbnail", error);
        setThumbnail({ kind: "unavailable" });
      }
    })();

    return () => {
      controller.abort();
      loaded?.destroy();
    };
  }, [payslipId]);

  switch (thumbnail.kind) {
    case "loading":
      return <Skeleton className="h-40 w-28" />;
    case "image":
      return (
        <img
          src={thumbnail.url}
          alt=""
          className="block h-40 w-auto max-w-full object-contain"
          // HEIC outside Safari: the browser cannot decode it.
          onError={() => setThumbnail({ kind: "unavailable" })}
        />
      );
    case "pdf":
      return <PageThumbnail document={thumbnail.document} page={1} width={112} />;
    case "unavailable":
      return (
        <p className="flex h-40 w-28 flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-center text-xs text-slate-600">
          <FileImage aria-hidden="true" className="size-6" />
          {t("merge.noPreview")}
        </p>
      );
  }
}
