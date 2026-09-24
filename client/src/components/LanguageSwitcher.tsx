import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  function select(language: SupportedLanguage) {
    void i18n.changeLanguage(language).then(() => {
      document.documentElement.lang = language;
    });
  }

  return (
    <div role="group" aria-label={t("common.language")} className="flex gap-1">
      {SUPPORTED_LANGUAGES.map((language) => {
        const active = i18n.resolvedLanguage === language;
        return (
          <button
            key={language}
            type="button"
            lang={language}
            aria-pressed={active}
            onClick={() => {
              select(language);
            }}
            className={`grid min-h-11 min-w-11 place-items-center rounded-lg text-xs font-semibold uppercase transition-colors ${
              active ? "bg-accent-soft text-accent" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {language}
          </button>
        );
      })}
    </div>
  );
}
