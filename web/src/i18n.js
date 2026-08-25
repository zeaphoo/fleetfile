import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

const saved = (() => {
  try {
    return localStorage.getItem("fleetfile:lang");
  } catch {
    return null;
  }
})();

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: saved || "zh",
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

export function setLanguage(lang) {
  i18n.changeLanguage(lang);
  try {
    localStorage.setItem("fleetfile:lang", lang);
  } catch {
    /* noop */
  }
}

export default i18n;
