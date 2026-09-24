import { useTranslation } from "react-i18next";

/** A stub until Task 07 builds multi-payslip capture on the kept `capture/` modules. */
export function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("home.title")}</h1>
      <p className="mt-2 text-slate-600">{t("home.subtitle")}</p>
    </div>
  );
}
