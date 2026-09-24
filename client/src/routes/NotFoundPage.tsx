import { useTranslation } from "react-i18next";

export function NotFoundPage() {
  const { t } = useTranslation();

  return <p className="mx-auto max-w-3xl px-4 py-6 text-slate-600">{t("errors.notFound")}</p>;
}
