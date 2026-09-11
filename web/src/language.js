const languages = require('./data/languages.json');

function findLanguage(code) {
  if (typeof code !== 'string') {
    return undefined;
  }

  const normalized = code.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return languages.find(lang =>
    normalized === lang.code3 ||
    normalized === lang.code2 ||
    (lang.extraCodes && lang.extraCodes.includes(normalized))
  );
}

function canonicalizeLanguageCode(code) {
  const lang = findLanguage(code);
  return lang ? lang.code3 : code;
}

module.exports = {
  languages,
  findLanguage,
  canonicalizeLanguageCode,
};
