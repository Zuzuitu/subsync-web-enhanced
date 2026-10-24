import { i18nConfig }  from 'es2015-i18n-tag';
import pl from './pl.json';
import ro from './ro.json';

const translations = { ro, pl, en: {} };

export default function setTranslation(lang) {
  i18nConfig({
    locales: lang || 'en',
    translations: translations[lang] || {},
  });
}
