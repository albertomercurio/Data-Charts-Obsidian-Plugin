// ECharts ships its locales as plain objects without type declarations.
declare module "echarts/lib/i18n/*.js" {
  const locale: object;
  export default locale;
}
