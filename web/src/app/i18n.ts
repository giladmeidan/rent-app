import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import he from '../locales/he.json';

// Resources are bundled, so init synchronously: the first render already has every string.
void i18n.use(initReactI18next).init({
  lng: 'he',
  fallbackLng: 'he',
  resources: { he: { translation: he } },
  interpolation: { escapeValue: false },
  initAsync: false,
});

export default i18n;
