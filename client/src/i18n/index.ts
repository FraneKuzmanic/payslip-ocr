import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import hr from "./locales/hr.json";

export const SUPPORTED_LANGUAGES = ["hr", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Makes every translation key compiler-checked, which is what turns "no hardcoded
 * user-facing strings" (PRD §7.13) into a rule the build enforces.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hr: { translation: hr },
    },
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export default i18n;
