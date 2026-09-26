import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SourceRegion } from "@payslip/shared";
import { SourceOverlay } from "./SourceOverlay";
import { boundsOf } from "./sourceZoom";
import { stripView } from "./stripGeometry";

interface SourceStripProps {
  ratio: number;
  overlaySafe: boolean;
  regions: readonly SourceRegion[];
  page: number;
  activeField: string | null;
  editedFields: readonly string[];
  children: (surfaceWidth: number) => ReactNode;
}

/** A visual duplicate of the focused input's source, never an interactive second preview. */
export function SourceStrip({
  ratio,
  overlaySafe,
  regions,
  page,
  activeField,
  editedFields,
  children,
}: SourceStripProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const region =
    activeField === null
      ? undefined
      : regions.find(
          (candidate) => candidate.page === page && candidate.fields.includes(activeField),
        );
  const view =
    region && overlaySafe
      ? stripView(boundsOf(region.corners), ratio, { width, height: 64 })
      : null;
  return (
    <div
      ref={host}
      aria-hidden="true"
      inert
      className="pointer-events-none relative h-16 overflow-hidden"
    >
      {view === null || region === undefined ? (
        <p className="px-3 text-sm text-slate-600">{t("review.stripNoOutline")}</p>
      ) : (
        <div
          className="absolute"
          style={{
            width: view.surfaceWidth,
            aspectRatio: ratio,
            transform: `translate(${view.x}px, ${view.y}px)`,
          }}
        >
          {children(view.surfaceWidth)}
          <SourceOverlay
            regions={[region]}
            page={page}
            activeField={activeField}
            editedFields={editedFields}
            onSelect={() => {}}
          />
        </div>
      )}
    </div>
  );
}
