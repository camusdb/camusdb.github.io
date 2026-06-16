import siteConfig from '@generated/docusaurus.config';

const camusSqlKeywords =
  /\b(?:ADD|ALTER|ANALYZE|AND|AS|ASC|BEGIN|BETWEEN|BY|CAST|COLUMN|COLUMNS|COMMIT|COMMITTED|CONSTRAINT|CREATE|DATABASE|DEFAULT|DELETE|DESC|DESCRIBE|DISTINCT|DROP|EXISTS|EXPLAIN|FALSE|FORCE_INDEX|FROM|GROUP|HAVING|IF|ILIKE|IN|INDEX|INDEXES|INNER|INSERT|INTO|IS|ISOLATION|JOIN|KEY|LEVEL|LIKE|LIMIT|LOGICAL|NOT|NULL|OFFSET|ON|ONLY|OR|ORDER|PHYSICAL|PRIMARY|READ|ROLLBACK|SELECT|SERIALIZABLE|SET|SHOW|START|TABLE|TABLES|TRANSACTION|TRUE|UNIQUE|UPDATE|VALUES|WHERE|WRITE)\b/i;

const camusSqlTypes =
  /\b(?:BOOL|BOOLEAN|DOUBLE|FLOAT64|INT64|INTEGER|OBJECT_ID|OID|STRING)\b/i;

const camusSqlFunctions =
  /\b(?:ABS|ACOS|ASIN|ATAN|ATAN2|AVG|CAST|CEIL|CEILING|COALESCE|CONCAT|CONTAINS|COS|COUNT|CURRENT_DATE|CURRENT_TIMESTAMP|DATE_ADD|DATE_DIFF|DATE_FORMAT|DATE_PARSE|DATE_PART|DATE_SUB|DATE_TRUNC|DAY|ENDS_WITH|EXP|FLOOR|FROM_UNIXTIME|GEN_ID|HOUR|JSON_ARRAY_LENGTH|JSON_CONTAINS|JSON_EXTRACT|JSON_TYPE|JSON_VALID|JSON_VALUE|LENGTH|LN|LOG|LOWER|LTRIM|MAX|MIN|MINUTE|MOD|MONTH|NOW|NULLIF|PI|POW|POWER|RAND|RANDOM|REPLACE|ROUND|RTRIM|SECOND|SIGN|SIN|SQRT|STARTS_WITH|STR_ID|SUBSTR|SUBSTRING|SUM|TAN|TO_BOOL|TO_FLOAT64|TO_ID|TO_INT64|TO_STRING|TRIM|UNIX_MICROSECONDS|UNIX_MILLISECONDS|UNIX_SECONDS|UNIX_TIMESTAMP|UPPER|YEAR)\b/i;

function registerCamusSql(PrismObject) {
  if (!PrismObject.languages.sql) {
    require('prismjs/components/prism-sql');
  }

  PrismObject.languages.camussql = PrismObject.languages.extend('sql', {
    keyword: camusSqlKeywords,
    function: camusSqlFunctions,
  });

  PrismObject.languages.insertBefore('camussql', 'keyword', {
    builtin: {
      pattern: camusSqlTypes,
      alias: 'class-name',
    },
  });
}

export default function prismIncludeLanguages(PrismObject) {
  const {
    themeConfig: {prism},
  } = siteConfig;
  const {additionalLanguages} = prism;
  const PrismBefore = globalThis.Prism;

  globalThis.Prism = PrismObject;
  additionalLanguages.forEach((lang) => {
    if (lang === 'php') {
      require('prismjs/components/prism-markup-templating.js');
    }
    require(`prismjs/components/prism-${lang}`);
  });
  registerCamusSql(PrismObject);

  delete globalThis.Prism;
  if (typeof PrismBefore !== 'undefined') {
    globalThis.Prism = PrismBefore;
  }
}
