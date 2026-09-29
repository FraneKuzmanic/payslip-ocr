import { Plus, TriangleAlert, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import {
  useFieldArray,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { TablesStatus } from "@payslip/shared";
import { Skeleton } from "../components/Skeleton";
import { useWideLayout } from "../history/useWideLayout";
import {
  attentionCount,
  attentionFor,
  sectionWarnings,
  type AttentionSignals,
} from "./fieldAttention";
import { attentionMessage, fieldId, inputClass } from "./ReviewField";
import { SECTION_LABEL_KEYS, fieldLabel, type TableField } from "./regionSections";
import {
  columnKind,
  columnsOf,
  validatorFor,
  type InputPath,
  type ReviewErrorKey,
  type ReviewFormValues,
  type RowValues,
} from "./reviewForm";
import { SectionLegend, ToCheck } from "./SectionLegend";

interface LineItemSectionProps<T extends TableField> {
  table: T;
  control: Control<ReviewFormValues>;
  register: UseFormRegister<ReviewFormValues>;
  tablesStatus: TablesStatus;
  signals: AttentionSignals;
  errors: FieldErrors<ReviewFormValues>;
  /** Task 15 D9: the section is a disclosure; closed, its body stays mounted but hidden. */
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One line-item table (Task 09): a real `<table>` at `lg` and condensed cards on a phone, chosen
 * once by `useWideLayout` so both never reach the accessibility tree. The column name is carried
 * once, by a header or a caption, and each row's attention and format errors collapse into one
 * visible note under it: the receipt-ocr form this is ported from registered validation here but
 * never rendered its errors, so a bad amount blocked saving with no message.
 *
 * While the tables pass is pending the section is a read-only skeleton, because that pass would
 * overwrite an edit made before it lands (Task 05). Once it has failed, the section says so and
 * rows can be added by hand (D8).
 *
 * The section is a disclosure (Task 15 D9) whose header carries the row count, or the pending
 * state, and how many cells need a look. A closed body stays mounted with `hidden`, so its fields
 * stay registered and a region click can open it and focus a cell.
 */
export function LineItemSection<T extends TableField>({
  table,
  control,
  register,
  tablesStatus,
  signals,
  errors,
  expanded,
  onToggle,
}: LineItemSectionProps<T>) {
  const { t } = useTranslation();
  const wide = useWideLayout();
  const rows = useFieldArray<ReviewFormValues, T>({ control, name: table });
  const columns = columnsOf(table);
  // Every column of a known table has a label key, which `fieldLabels.test.ts` guards.
  const columnLabel = (column: string) => t(fieldLabel(`${table}.0.${column}`)!.key);
  const section = t(SECTION_LABEL_KEYS[table]);
  const tableErrors = errors[table] as
    ReadonlyArray<Partial<Record<string, { message?: string }>> | undefined> | undefined;
  const warned = sectionWarnings(table, signals.warnings);
  const pending = tablesStatus === "pending";
  const bodyId = `review-section-${table}`;
  const cellPaths = rows.fields.flatMap((_, index) =>
    columns.map((column) => `${table}.${index}.${column}`),
  );

  const header = (
    <SectionLegend
      section={table}
      label={section}
      expanded={expanded}
      controls={bodyId}
      onToggle={onToggle}
      summary={
        <>
          {pending
            ? t("tablesStatus.pending")
            : t("review.rowCount", { count: rows.fields.length })}
          <ToCheck count={attentionCount(cellPaths, signals, warned)} />
        </>
      }
    />
  );
  const warning =
    warned.length > 0 ? (
      <p className="flex items-start gap-1 text-sm text-amber-900">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{warned.map((code) => t(`warnings.${code}`)).join(" ")}</span>
      </p>
    ) : null;

  /** The header, then the body, hidden rather than unmounted while closed. */
  function inSection(body: ReactNode) {
    return (
      <fieldset className="flex flex-col gap-3">
        {header}
        <div id={bodyId} hidden={!expanded} className="flex flex-col gap-3">
          {warning}
          {body}
        </div>
      </fieldset>
    );
  }

  if (pending) {
    // Hidden while closed, so not announced; the header carries the pending text instead.
    return inSection(
      <div role="status" className="flex flex-col gap-2">
        <span className="text-sm text-slate-600">{t("tablesStatus.pending")}</span>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>,
    );
  }

  /** Each cell's state, and the one note that explains the flagged and invalid cells of a row. */
  function rowState(index: number) {
    const noteId = `review-row-note-${table}-${index}`;
    const cells = columns.map((column) => {
      const path = `${table}.${index}.${column}`;
      const attention = attentionFor(path, signals);
      const error = tableErrors?.[index]?.[column]?.message as ReviewErrorKey | undefined;
      return { column, path, attention, error };
    });
    const flagged = cells.filter((cell) => cell.attention !== null || cell.error !== undefined);
    const note: ReactNode =
      flagged.length === 0 ? null : (
        <span id={noteId} className="flex flex-col gap-1 text-sm">
          {flagged.map((cell) => (
            <span key={cell.column}>
              <span className="font-medium">{columnLabel(cell.column)}</span>{" "}
              {cell.attention ? (
                <span className="inline-flex items-start gap-1 text-amber-900">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {attentionMessage(cell.attention, t)}
                </span>
              ) : null}{" "}
              {cell.error ? <span className="text-red-700">{t(cell.error)}</span> : null}
            </span>
          ))}
        </span>
      );
    return { cells, note, noteId };
  }

  function input(
    cell: ReturnType<typeof rowState>["cells"][number],
    noteId: string,
    ariaLabel?: string,
  ) {
    const kind = columnKind(table, cell.column);
    const flagged = cell.attention !== null || cell.error !== undefined;
    const props = {
      ...register(cell.path as InputPath, { validate: validatorFor(kind) }),
      id: fieldId(cell.path),
      autoComplete: "off",
      className: inputClass(cell.attention !== null, cell.error !== undefined),
      "aria-label": ariaLabel,
      ...(flagged ? { "aria-describedby": noteId } : {}),
      ...(cell.error === undefined ? {} : { "aria-invalid": true }),
    };
    // Without `field-sizing` (Firefox, older Safari) a one-row textarea would hide its wrapped
    // second line, which is worse than an input's horizontal scroll.
    if (wide && kind === "text" && (globalThis.CSS?.supports?.("field-sizing", "content") ?? false))
      return (
        <textarea
          {...props}
          rows={1}
          style={{ fieldSizing: "content" }}
          className={`${props.className} resize-none overflow-hidden py-3`}
          // Still a single-line value (Task 09 D17): Enter saves, as it does in every input.
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
      );
    return <input {...props} type="text" inputMode={kind === "text" ? undefined : "decimal"} />;
  }

  function removeButton(index: number) {
    return (
      <button
        type="button"
        onClick={() => rows.remove(index)}
        aria-label={t("review.removeRow", { row: index + 1 })}
        className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    );
  }

  const blankRow = Object.fromEntries(columns.map((column) => [column, ""])) as RowValues<T>;
  // Task 15 D14: a text action at every width, as receipt-ocr's "Add item".
  const addButton = (
    <button
      type="button"
      // RHF's field-array value type does not narrow through the generic table name.
      onClick={() => rows.append(blankRow as never)}
      className="inline-flex min-h-12 items-center gap-1 self-start font-semibold text-accent underline underline-offset-4 hover:text-accent-hover"
    >
      <Plus aria-hidden="true" className="size-4" />
      {t("review.addRow")}
    </button>
  );

  const failedNotice =
    tablesStatus === "failed" ? (
      <p className="text-sm text-slate-700">{t("review.tablesFailed")}</p>
    ) : null;

  if (!wide) {
    return inSection(
      <>
        {failedNotice}
        {rows.fields.map((field, index) => {
          const { cells, note, noteId } = rowState(index);
          return (
            <div
              key={field.id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-600">
                  {t("review.rowLabel", { section, row: index + 1 })}
                </p>
                {removeButton(index)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {cells.map((cell) => (
                  <label
                    key={cell.column}
                    className={`flex min-w-0 flex-col gap-1 ${
                      columnKind(table, cell.column) === "text" ? "col-span-2" : ""
                    }`}
                  >
                    <span className="text-sm text-slate-600">{columnLabel(cell.column)}</span>
                    {input(cell, noteId)}
                  </label>
                ))}
              </div>
              {note}
            </div>
          );
        })}
        {addButton}
      </>,
    );
  }

  return inSection(
    <>
      {failedNotice}
      {rows.fields.length > 0 ? (
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            {columns.map((column) => (
              <col
                key={column}
                className={columnKind(table, column) === "text" ? undefined : "w-28"}
              />
            ))}
            <col className="w-14" />
          </colgroup>
          <thead>
            <tr className="text-left text-sm text-slate-600">
              {columns.map((column) => (
                <th key={column} scope="col" className="pb-1 pr-2 font-medium">
                  {columnLabel(column)}
                </th>
              ))}
              {/* The removal column needs no header: each button names its row. */}
              <td />
            </tr>
          </thead>
          <tbody>
            {rows.fields.map((field, index) => {
              const { cells, note, noteId } = rowState(index);
              return (
                <Fragment key={field.id}>
                  <tr>
                    {cells.map((cell) => (
                      <td key={cell.column} className="pb-2 pr-2 align-top">
                        {input(
                          cell,
                          noteId,
                          t("review.cellLabel", {
                            column: columnLabel(cell.column),
                            section,
                            row: index + 1,
                          }),
                        )}
                      </td>
                    ))}
                    <td className="pb-2 align-top">{removeButton(index)}</td>
                  </tr>
                  {note ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="pb-2">
                        {note}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {addButton}
    </>,
  );
}
