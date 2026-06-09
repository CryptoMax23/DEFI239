/** @type {import('@lingui/conf').LinguiConfig} */

module.exports = {
  locales: [
    "en",
    "es",
    "fr",
    "de",
    "it",
    "pt",
    "ru",
    "zh-Hans",
    "ja",
    "ko",
    "tr",
    "ar",
  ],
  catalogs: [
    {
      path: "src/locales/{locale}/messages",
      include: ["./components", "./pages"],
    },
  ],
  format: "po",
};
