import siteConfig from '@generated/docusaurus.config';

const camusSqlKeywords =
  /\b(?:ADD|ALL|ALTER|ANALYZE|ANCESTORS|AND|AS|ASC|BEGIN|BETWEEN|BRANCH|BRANCHES|BY|CACHE|CAST|CHECK|CLEAR|COLUMN|COLUMNS|COMMIT|COMMITTED|CONSTRAINT|CREATE|DATABASE|DATABASES|DEFAULT|DELETE|DESC|DESCRIBE|DISTINCT|DROP|EVICT|EXISTS|EXIT|EXPLAIN|FALSE|FORCE_INDEX|FROM|GROUP|HAVING|IF|ILIKE|IN|INDEX|INDEXES|INNER|INSERT|INTO|IS|ISOLATION|JOIN|KEY|LEVEL|LIKE|LIMIT|LOGICAL|NOT|NULL|OFFSET|ON|ONLY|OR|ORDER|PHYSICAL|PRIMARY|QUIT|READ|RENAME|ROLLBACK|SELECT|SERIALIZABLE|SET|SHOW|SOURCE|START|STRICT|TABLE|TABLES|TO|TRANSACTION|TRUE|UNIQUE|UPDATE|USE|VALUES|VIEW|VIEWS|WHERE|WRITE)\b/i;

const camusSqlTypes =
  /\b(?:ARRAY|BLOB|BOOL|BOOLEAN|BYTES|CHAR|DATE|DATETIME|DOUBLE|FLOAT32|FLOAT64|GUID|INT|INT64|INTEGER|OBJECT_ID|OID|REAL|STRING|TEXT|TIMESTAMP|UUID|VARCHAR)\b/i;

const camusSqlFunctions =
  /\b(?:ABS|ACOS|ASIN|ATAN|ATAN2|AVG|CAST|CEIL|CEILING|COALESCE|CONCAT|CONTAINS|COS|COUNT|CURRENT_DATE|CURRENT_TIMESTAMP|DATE_ADD|DATE_DIFF|DATE_FORMAT|DATE_PARSE|DATE_PART|DATE_SUB|DATE_TRUNC|DAY|ENDS_WITH|EXP|FLOOR|FROM_UNIXTIME|GEN_ID|GEN_UUID_V4|GEN_UUID_V7|HOUR|IFNULL|JSON_ARRAY_LENGTH|JSON_CONTAINS|JSON_EXTRACT|JSON_TYPE|JSON_VALID|JSON_VALUE|LENGTH|LN|LOG|LOWER|LTRIM|MAX|MIN|MINUTE|MOD|MONTH|NOW|NULLIF|NVL|PI|POW|POWER|RAND|RANDOM|REGEXP_COUNT|REGEXP_INSTR|REGEXP_LIKE|REGEXP_MATCH|REGEXP_MATCHES|REGEXP_REPLACE|REGEXP_SPLIT_TO_ARRAY|REGEXP_SPLIT_TO_TABLE|REGEXP_SUBSTR|REPLACE|ROUND|RTRIM|SECOND|SIGN|SIN|SQRT|STARTS_WITH|STR_ID|SUBSTR|SUBSTRING|SUM|TAN|TO_BOOL|TO_BYTES|TO_DATE|TO_DATETIME|TO_FLOAT32|TO_FLOAT64|TO_ID|TO_INT64|TO_STRING|TRIM|UNIX_MICROSECONDS|UNIX_MILLISECONDS|UNIX_SECONDS|UNIX_TIMESTAMP|UPPER|YEAR)\b/i;

const camusSqlOperators =
  /!~\*|~\*|!~|~|<>|!=|<=|>=|[-+*/%=<>]/;

const camusSqlNumbers =
  /\b(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/i;

function registerCamusSql(PrismObject) {
  if (!PrismObject.languages.sql) {
    require('prismjs/components/prism-sql');
  }

  PrismObject.languages.camussql = PrismObject.languages.extend('sql', {
    keyword: camusSqlKeywords,
    function: camusSqlFunctions,
    operator: camusSqlOperators,
    number: camusSqlNumbers,
  });

  PrismObject.languages.insertBefore('camussql', 'keyword', {
    builtin: {
      pattern: camusSqlTypes,
      alias: 'class-name',
    },
  });

  PrismObject.languages.camusdbsql = PrismObject.languages.camussql;
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
