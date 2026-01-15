import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';

const resources = {
  en: { translation: en },
  'zh-TW': { translation: zhTW }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: 'zh-TW',
    fallbackLng: 'zh-TW',
    supportedLngs: ['en', 'zh-TW'],
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage']
    }
  });

export default i18n;
