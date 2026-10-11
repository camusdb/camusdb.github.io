import clsx from 'clsx';
import {useEffect, useMemo, useRef, useState} from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';
import {loadEngine} from './runtime';

export const defaultSeedScript = `
CREATE TABLE authors (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  country STRING NOT NULL,
  born INT64 NOT NULL
);

CREATE TABLE books (
  id OID PRIMARY KEY NOT NULL,
  title STRING NOT NULL,
  author STRING NOT NULL,
  year INT64 NOT NULL,
  pages INT64 NOT NULL,
  price FLOAT64 NOT NULL
);

CREATE INDEX books_year ON books (year);

INSERT INTO authors (id, name, country, born) VALUES
  (GEN_ID(), 'Ursula K. Le Guin', 'US', 1929),
  (GEN_ID(), 'Isaac Asimov', 'US', 1920),
  (GEN_ID(), 'Stanislaw Lem', 'PL', 1921),
  (GEN_ID(), 'Arthur C. Clarke', 'UK', 1917),
  (GEN_ID(), 'Octavia E. Butler', 'US', 1947),
  (GEN_ID(), 'Iain M. Banks', 'UK', 1954),
  (GEN_ID(), 'Liu Cixin', 'CN', 1963);

INSERT INTO books (id, title, author, year, pages, price) VALUES
  (GEN_ID(), 'A Wizard of Earthsea', 'Ursula K. Le Guin', 1968, 183, 9.99),
  (GEN_ID(), 'The Left Hand of Darkness', 'Ursula K. Le Guin', 1969, 304, 12.50),
  (GEN_ID(), 'The Dispossessed', 'Ursula K. Le Guin', 1974, 387, 13.25),
  (GEN_ID(), 'Foundation', 'Isaac Asimov', 1951, 255, 8.75),
  (GEN_ID(), 'I, Robot', 'Isaac Asimov', 1950, 253, 7.99),
  (GEN_ID(), 'The Gods Themselves', 'Isaac Asimov', 1972, 288, 10.40),
  (GEN_ID(), 'Solaris', 'Stanislaw Lem', 1961, 204, 11.00),
  (GEN_ID(), 'The Cyberiad', 'Stanislaw Lem', 1965, 295, 12.00),
  (GEN_ID(), 'Childhood''s End', 'Arthur C. Clarke', 1953, 214, 9.25),
  (GEN_ID(), 'Rendezvous with Rama', 'Arthur C. Clarke', 1973, 256, 10.99),
  (GEN_ID(), 'Kindred', 'Octavia E. Butler', 1979, 264, 14.00),
  (GEN_ID(), 'Parable of the Sower', 'Octavia E. Butler', 1993, 345, 15.50),
  (GEN_ID(), 'Consider Phlebas', 'Iain M. Banks', 1987, 471, 16.20),
  (GEN_ID(), 'The Player of Games', 'Iain M. Banks', 1988, 309, 13.75),
  (GEN_ID(), 'The Three-Body Problem', 'Liu Cixin', 2008, 400, 17.99);
`;

export const defaultExamples = [
  {
    label: 'Databases',
    sql: 'SHOW DATABASES;',
  },
  {
    label: 'Branching',
    sql: 'CREATE DATABASE IF NOT EXISTS books_lab BRANCH FROM playground;\n\nSHOW DATABASES;\nSHOW BRANCHES FROM playground;',
  },
  {
    label: 'Filter and sort',
    sql: 'SELECT title, author, year\nFROM books\nWHERE year < 1970\nORDER BY year;',
  },
  {
    label: 'Join and group',
    sql: 'SELECT a.country, COUNT(*) AS books, AVG(b.price) AS avg_price\nFROM books b\nJOIN authors a ON b.author = a.name\nGROUP BY a.country\nORDER BY books DESC;',
  },
  {
    label: 'Subquery',
    sql: "SELECT title, year\nFROM books\nWHERE author IN (SELECT name FROM authors WHERE country = 'UK')\nORDER BY year;",
  },
  {
    label: 'Returning',
    sql: `CREATE TABLE IF NOT EXISTS reading_list (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  title STRING NOT NULL,
  added_at DATETIME NOT NULL DEFAULT (now())
);

INSERT INTO reading_list (title)
VALUES ('The Dispossessed'), ('Kindred')
RETURNING id, title, added_at;`,
  },
  {
    label: 'Foreign keys',
    sql: `CREATE TABLE IF NOT EXISTS publishers (
  code STRING PRIMARY KEY NOT NULL,
  name STRING NOT NULL
);

CREATE TABLE IF NOT EXISTS editions (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  publisher STRING NOT NULL,
  title STRING NOT NULL,
  CONSTRAINT editions_publisher_fk
    FOREIGN KEY (publisher) REFERENCES publishers (code)
    ON DELETE RESTRICT
);

DELETE FROM editions WHERE publisher IN ('ace', 'orb');
DELETE FROM publishers WHERE code IN ('ace', 'orb');

INSERT INTO publishers (code, name) VALUES
  ('ace', 'Ace Books'),
  ('orb', 'Orb Books');

INSERT INTO editions (publisher, title) VALUES
  ('ace', 'The Left Hand of Darkness'),
  ('orb', 'Kindred');

SELECT e.title, p.name AS publisher
FROM editions e
JOIN publishers p ON e.publisher = p.code
ORDER BY e.title;

SHOW CREATE TABLE editions;`,
  },
  {
    label: 'Use the index',
    sql: 'EXPLAIN SELECT title FROM books WHERE year = 1969;',
  },
  {
    label: 'Update, then check',
    sql: "UPDATE books SET price = price * 0.9 WHERE year < 1960;\n\nSELECT title, price FROM books WHERE year < 1960 ORDER BY title;",
  },
  {
    label: 'Your own table',
    sql: "CREATE TABLE notes (id OID PRIMARY KEY NOT NULL, body STRING NOT NULL, stars INT64);\n\nINSERT INTO notes (id, body, stars) VALUES (GEN_ID(), 'Loved Solaris', 5), (GEN_ID(), 'Read Kindred next', NULL);\n\nSELECT body, stars FROM notes;",
  },
  {
    label: 'Schema',
    sql: 'SHOW TABLES;\n\nSHOW COLUMNS FROM books;',
  },
  {
    label: 'Functions',
    sql: "SELECT upper(title) AS shout, length(title) AS chars, md5(title) AS digest\nFROM books\nORDER BY chars DESC\nLIMIT 3;",
  },
];

export const tutorialExamples = [
  {
    label: 'Create database',
    sql: 'CREATE DATABASE IF NOT EXISTS factory;',
  },
  {
    label: 'Create table',
    sql: `CREATE TABLE IF NOT EXISTS robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  kind STRING NOT NULL,
  year INT64 DEFAULT (2024)
);`,
  },
  {
    label: 'Insert rows',
    sql: `INSERT INTO robots (id, name, kind, year)
VALUES
  (GEN_ID(), 'R2-D2', 'utility', 1977),
  (GEN_ID(), 'C-3PO', 'protocol', 1977),
  (GEN_ID(), 'T-800', 'android', 1984),
  (GEN_ID(), 'K-2SO', 'security', DEFAULT);`,
  },
  {
    label: 'Query rows',
    sql: `SELECT name, kind, year
FROM robots
WHERE year >= 1977
ORDER BY year, name;`,
  },
  {
    label: 'Add index',
    sql: `CREATE INDEX robots_year ON robots (year);

EXPLAIN SELECT name
FROM robots
WHERE year = 1977;`,
  },
  {
    label: 'Update and delete',
    sql: `UPDATE robots
SET kind = 'astromech'
WHERE name = 'R2-D2';

DELETE FROM robots
WHERE name = 'T-800';

SELECT name, kind, year
FROM robots
ORDER BY name;`,
  },
  {
    label: 'Experiment',
    sql: `SELECT kind, COUNT(*) AS robots
FROM robots
GROUP BY kind
ORDER BY robots DESC;`,
  },
];

const numericTypes = new Set(['Integer64', 'Float64', 'Float32', 'Numeric']);
const sqlKeywords = new Set([
  'ACTION', 'ADD', 'ALL', 'ALTER', 'ALWAYS', 'ANALYZE', 'ANCESTORS', 'AND', 'ANY', 'AS', 'ASC',
  'BACKGROUND', 'BEGIN', 'BETWEEN', 'BRANCH', 'BRANCHES', 'BY', 'CACHE',
  'CANCEL', 'CASCADE', 'CASCADED', 'CASE', 'CAST', 'CHECK', 'CLEAR', 'CLUSTER', 'COLUMN',
  'COLUMNS', 'COMMENT', 'COMMIT', 'COMMITTED', 'CONCURRENTLY', 'CONNECTIONS', 'CONSTRAINT',
  'CONTINUE', 'CREATE', 'CRITICAL', 'CROSS', 'CYCLE', 'DATA', 'DATABASE', 'DATABASES', 'DEFAULT', 'DEFERRABLE', 'DEFERRED', 'DELETE',
  'DESC', 'DESCRIBE', 'DISTINCT', 'DROP', 'ELSE', 'END', 'ENGINE', 'EVICT',
  'EXISTS', 'EXIT', 'EXPLAIN', 'EXTERNAL', 'EXTENDED', 'FALSE', 'FOR', 'FORCE',
  'FORCE_INDEX', 'FOREIGN', 'FROM', 'FULL', 'GENERATED', 'GRANT', 'GRANTS', 'GROUP', 'HAVING', 'HIGH',
  'IDENTIFIED', 'IDENTITY', 'IF', 'ILIKE', 'IMMEDIATE', 'IN', 'INCLUDE', 'INCREMENT', 'INDEX', 'INDEXES', 'INITIALLY', 'INLINE',
  'INNER', 'INSERT', 'INTO', 'IS', 'ISOLATION', 'JOIN', 'KEY', 'LEFT', 'LEVEL', 'LIKE',
  'LIMIT', 'LOCAL', 'LOCKING', 'LOGICAL', 'LOW', 'MAIN', 'MATCH', 'MATERIALIZED', 'MAXVALUE', 'MINVALUE', 'NATURAL', 'NO',
  'NORMAL', 'NOT', 'NULL', 'OF', 'OFFSET', 'ON', 'ONLY', 'OPTIMISTIC', 'OPTION',
  'OR', 'ORDER', 'ORPHAN', 'OUTER', 'OWNED', 'OWNER', 'PARTIAL', 'PASSWORD', 'PESSIMISTIC', 'PHYSICAL',
  'PLAIN', 'PRIMARY', 'PRIORITY', 'PRIVILEGES', 'QUERIES', 'QUERY', 'QUIT',
  'RANGE', 'RANGES', 'READ', 'REFERENCES', 'REFRESH', 'RELINK', 'RENAME', 'REPLACE', 'RESET', 'RESTART', 'RESTRICT', 'RETURNING', 'REVOKE',
  'REWRITE', 'RIGHT', 'ROLLBACK', 'SELECT', 'SEQUENCE', 'SEQUENCES', 'SERIALIZABLE', 'SET', 'SETTING', 'SETTINGS',
  'SHOW', 'SIMPLE', 'SLOW', 'SOME', 'SOURCE', 'START', 'STATISTICS', 'STATS', 'STORAGE',
  'STRICT', 'SYSTEM', 'TABLE', 'TABLES', 'THEN', 'TIME', 'TO', 'TRANSACTION',
  'TRUE', 'TRUNCATE', 'TTL', 'UNIQUE', 'UPDATE', 'USE', 'USER', 'USING', 'VALID', 'VALIDATE', 'VALUES',
  'VARIABLES', 'VIEW', 'VIEWS', 'WHEN', 'WHERE', 'WITH', 'WITHOUT', 'WRITE',
]);
const sqlTypes = new Set([
  'ARRAY', 'BLOB', 'BOOL', 'BOOLEAN', 'BYTES', 'CHAR', 'DATE', 'DATETIME',
  'BIGSERIAL', 'DECIMAL', 'DOUBLE', 'FLOAT', 'FLOAT32', 'FLOAT64', 'GUID', 'INT', 'INT64',
  'INTEGER', 'NUMERIC', 'OBJECT_ID', 'OID', 'REAL', 'SERIAL', 'SMALLINT', 'STRING', 'TEXT',
  'TIMESTAMP', 'UUID', 'VARCHAR',
]);
const sqlFunctions = new Set([
  'ABS', 'ACOS', 'ARRAY_CONTAINS', 'ARRAY_LENGTH', 'ASIN', 'ATAN', 'ATAN2',
  'AVG', 'CARDINALITY', 'CEIL', 'CEILING', 'COALESCE', 'CONCAT', 'CONTAINS',
  'COS', 'COSINE_DISTANCE', 'COUNT', 'CURRENT_DATABASE', 'CURRENT_DATE', 'CURRVAL',
  'CURRENT_ROLE', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'DATE_ADD', 'DATE_DIFF',
  'DATE_FORMAT', 'DATE_PARSE', 'DATE_PART', 'DATE_SUB', 'DATE_TRUNC', 'DAY',
  'ENDS_WITH', 'EXP', 'FLOOR', 'FROM_UNIXTIME', 'GEN_ID', 'GEN_UUID_V4',
  'GEN_UUID_V7', 'HOUR', 'IFNULL', 'INNER_PRODUCT', 'IS_SUPERUSER',
  'JSON_ARRAY_LENGTH', 'JSON_CONTAINS', 'JSON_EXTRACT', 'JSON_TYPE',
  'JSON_VALID', 'JSON_VALUE', 'L2_DISTANCE', 'LASTVAL', 'LENGTH', 'LN', 'LOG', 'LOWER',
  'LTRIM', 'MAX', 'MD5', 'MIN', 'MINUTE', 'MOD', 'MONTH', 'NOW', 'NULLIF',
  'NEXTVAL', 'NVL', 'OCTET_LENGTH', 'PI', 'POW', 'POWER', 'RAND', 'RANDOM',
  'REGEXP_COUNT', 'REGEXP_INSTR', 'REGEXP_LIKE', 'REGEXP_MATCH',
  'REGEXP_MATCHES', 'REGEXP_REPLACE', 'REGEXP_SPLIT_TO_ARRAY',
  'REGEXP_SPLIT_TO_TABLE', 'REGEXP_SUBSTR', 'REPLACE', 'ROUND', 'RTRIM',
  'SECOND', 'SETVAL', 'SHA1', 'SHA256', 'SHA512', 'SIGN', 'SIN', 'SQRT', 'STARTS_WITH',
  'STR_ID', 'SUBSTR', 'SUBSTRING', 'SUM', 'TAN', 'TO_BOOL', 'TO_BYTES',
  'TO_DATE', 'TO_DATETIME', 'TO_FLOAT32', 'TO_FLOAT64', 'TO_ID', 'TO_INT64',
  'TO_STRING', 'TRIM', 'TRUNC', 'UNIX_MICROSECONDS', 'UNIX_MILLISECONDS',
  'UNIX_SECONDS', 'UNIX_TIMESTAMP', 'UPPER', 'VECTOR_DIMS', 'YEAR',
]);

function readQuoted(sql, start) {
  const quote = sql[start];
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      index += 1;
      break;
    }
    if ((quote === '"' || quote === "'") && sql[index] === '\\') {
      index += 2;
      continue;
    }
    index += 1;
  }
  return index;
}

function tokenizeSql(sql) {
  const tokens = [];
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);
    const char = sql[index];

    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index);
      const next = end === -1 ? sql.length : end;
      tokens.push({kind: 'comment', value: sql.slice(index, next)});
      index = next;
      continue;
    }

    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2);
      const next = end === -1 ? sql.length : end + 2;
      tokens.push({kind: 'comment', value: sql.slice(index, next)});
      index = next;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      const next = readQuoted(sql, index);
      tokens.push({kind: char === '`' ? 'identifier' : 'string', value: sql.slice(index, next)});
      index = next;
      continue;
    }

    const number = /^(?:0x[0-9a-f]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d[\d_]*)?)/i.exec(rest);
    if (number) {
      tokens.push({kind: 'number', value: number[0]});
      index += number[0].length;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (word) {
      const value = word[0];
      const upper = value.toUpperCase();
      const after = sql.slice(index + value.length).trimStart();
      let kind = 'plain';
      if (sqlTypes.has(upper)) kind = 'type';
      else if (sqlKeywords.has(upper)) kind = 'keyword';
      else if (sqlFunctions.has(upper) || after.startsWith('(')) kind = 'function';
      tokens.push({kind, value});
      index += value.length;
      continue;
    }

    const operator = /^(?:!~\*|~\*|!~|~|::|<>|!=|<=|>=|[-+*/%=<>()[\],.;])/.exec(rest);
    if (operator) {
      tokens.push({kind: 'operator', value: operator[0]});
      index += operator[0].length;
      continue;
    }

    tokens.push({kind: 'plain', value: char});
    index += 1;
  }

  return tokens;
}

export function HighlightedSql({code, highlightRef}) {
  const tokens = useMemo(() => tokenizeSql(code), [code]);
  return (
    <pre className={styles.highlightLayer} aria-hidden="true">
      <code ref={highlightRef}>
        {tokens.map((token, index) => (
          token.kind === 'plain'
            ? token.value
            : <span className={styles[token.kind]} key={index}>{token.value}</span>
        ))}
        {'\n'}
      </code>
    </pre>
  );
}

export function SqlLineNumbers({code, lineNumbersRef}) {
  const lineCount = useMemo(() => code.split('\n').length, [code]);

  return (
    <div className={styles.lineNumbers} aria-hidden="true">
      <div ref={lineNumbersRef}>
        {Array.from({length: lineCount}, (_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
    </div>
  );
}

export function syncEditorScroll(target, highlightRef, lineNumbersRef) {
  if (highlightRef.current) {
    highlightRef.current.style.transform =
      `translate(${-target.scrollLeft}px, ${-target.scrollTop}px)`;
  }

  if (lineNumbersRef.current) {
    lineNumbersRef.current.style.transform = `translateY(${-target.scrollTop}px)`;
  }
}

function formatMs(value) {
  return value < 10 ? value.toFixed(1) : Math.round(value);
}

function describeOutcome(outcome) {
  const ms = formatMs(outcome.ms ?? 0);
  if (!outcome.ok) return `failed · ${ms} ms`;
  if (outcome.columns) {
    const count = outcome.rows?.length ?? 0;
    return `${count} row${count === 1 ? '' : 's'} · ${ms} ms`;
  }
  return `${outcome.affected ?? 0} affected · ${ms} ms`;
}

function Status({state, text}) {
  return (
    <div className={styles.status} data-state={state} role="status" aria-live="polite">
      <span className={styles.statusDot} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function EmptyResult({children, kind}) {
  return <p className={clsx(styles.empty, kind && styles[kind])}>{children}</p>;
}

function ResultTable({outcome}) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            {outcome.columns.map((column) => (
              <th
                className={numericTypes.has(column.type) ? styles.num : undefined}
                key={column.name}
                title={column.type}>
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outcome.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, valueIndex) => {
                const isNumber = typeof value === 'number';
                return (
                  <td
                    className={clsx(
                      isNumber && styles.num,
                      value === null && styles.nullValue,
                    )}
                    key={valueIndex}>
                    {value === null
                      ? 'NULL'
                      : typeof value === 'object'
                        ? JSON.stringify(value)
                        : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultCard({outcome}) {
  return (
    <article className={clsx(styles.resultCard, !outcome.ok && styles.failed)}>
      <header>
        <code>{outcome.sql}</code>
        <span>{describeOutcome(outcome)}</span>
      </header>
      {!outcome.ok ? (
        <p className={styles.errorText}>
          <strong>{outcome.code}</strong> {outcome.message}
        </p>
      ) : outcome.columns ? (
        outcome.rows?.length ? <ResultTable outcome={outcome} /> : <EmptyResult>No rows.</EmptyResult>
      ) : null}
      {outcome.warning && <p className={styles.warningText}>{outcome.warning}</p>}
    </article>
  );
}

export default function CamusPlayground({
  className,
  examples = defaultExamples,
  initialSql,
  seedScript = defaultSeedScript,
  compact = false,
  runExampleOnSelect = true,
  title = 'CamusDB playground',
  description = 'Run SQL against the real CamusDB engine in this browser tab.',
}) {
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState({state: 'loading', text: 'Loading the engine...'});
  const [sql, setSql] = useState(initialSql ?? examples[0]?.sql ?? '');
  const [results, setResults] = useState([]);
  const [database, setDatabase] = useState('playground');
  const [databases, setDatabases] = useState(['playground']);
  const [runKey, setRunKey] = useState('Ctrl Enter');
  const [selection, setSelection] = useState({start: 0, end: 0});
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const lineNumbersRef = useRef(null);

  const seed = useMemo(() => seedScript.trim(), [seedScript]);
  const selectedSql = useMemo(() => {
    const start = Math.max(0, Math.min(selection.start, selection.end, sql.length));
    const end = Math.max(0, Math.min(Math.max(selection.start, selection.end), sql.length));
    return start === end ? '' : sql.slice(start, end).trim();
  }, [selection, sql]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) {
          setRunKey('Cmd Enter');
        }

        const playground = await loadEngine((loaded, total) => {
          if (!cancelled) setStatus({state: 'loading', text: `Downloading engine... ${loaded}/${total}`});
        });
        if (cancelled) return;
        setStatus({state: 'loading', text: 'Starting the engine...'});

        await playground.InitAsync();
        await playground.ResetAsync();
        if (seed) {
          const loaded = JSON.parse(await playground.ExecuteAsync(seed));
          const failure = loaded.find((outcome) => !outcome.ok);
          if (failure) {
            throw new Error(`${failure.code}: ${failure.message}`);
          }
        }

        if (!cancelled) {
          await refreshDatabases(playground, 'playground');
          setEngine(playground);
          setBusy(false);
          setStatus({state: 'ready', text: 'Ready'});
        }
      } catch (error) {
        if (!cancelled) {
          setBusy(false);
          setStatus({
            state: 'error',
            text: `Engine failed to start: ${error.message}`,
          });
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [seed]);

  async function execute(engineApi, script, databaseName = database) {
    if (engineApi.ExecuteInDatabaseAsync) {
      return engineApi.ExecuteInDatabaseAsync(script, databaseName);
    }

    return engineApi.ExecuteAsync(script);
  }

  async function refreshDatabases(
    engineApi = engine,
    preferredDatabase = database,
    previousDatabases = databases,
    preferNewDatabase = false,
  ) {
    if (!engineApi) return preferredDatabase;

    const outcomes = JSON.parse(await engineApi.ExecuteAsync('SHOW DATABASES;'));
    const first = outcomes[0];
    if (!first?.ok || !Array.isArray(first.rows)) return preferredDatabase;

    const nextDatabases = first.rows
      .map((row) => row?.[0])
      .filter((value) => typeof value === 'string' && value.length > 0);

    if (!nextDatabases.length) return preferredDatabase;

    setDatabases(nextDatabases);
    const newDatabase = preferNewDatabase
      ? nextDatabases.find((name) => !previousDatabases.includes(name))
      : null;
    let nextDatabase = newDatabase;
    if (!nextDatabase) {
      nextDatabase = nextDatabases.includes(preferredDatabase)
        ? preferredDatabase
        : nextDatabases.includes('playground')
          ? 'playground'
          : nextDatabases[0];
    }
    setDatabase(nextDatabase);
    return nextDatabase;
  }

  async function run(nextSql = sql) {
    const script = nextSql.trim();
    if (!engine || busy || !script) return;

    setBusy(true);
    setStatus({state: 'loading', text: 'Running...'});
    try {
      const previousDatabases = databases;
      const outcomes = JSON.parse(await execute(engine, script, database));
      setResults(outcomes);
      const failed = outcomes.some((outcome) => !outcome.ok);
      await refreshDatabases(engine, database, previousDatabases, !failed);
      setStatus({
        state: failed ? 'error' : 'ready',
        text: failed ? 'A statement failed' : 'Ready',
      });
    } catch (error) {
      setResults([{ok: false, sql: script, code: 'EngineError', message: error.message, ms: 0}]);
      setStatus({state: 'error', text: 'Engine error'});
    } finally {
      setBusy(false);
    }
  }

  function updateSelection(target) {
    setSelection({
      start: target.selectionStart ?? 0,
      end: target.selectionEnd ?? 0,
    });
  }

  function getSelectedSql() {
    const target = textareaRef.current;
    if (!target) return selectedSql;

    const start = Math.max(0, Math.min(target.selectionStart ?? 0, sql.length));
    const end = Math.max(0, Math.min(target.selectionEnd ?? 0, sql.length));
    const currentSelection = start === end ? '' : sql.slice(start, end).trim();
    return currentSelection || selectedSql;
  }

  async function runSelected() {
    await run(getSelectedSql());
  }

  async function reset() {
    if (!engine || busy) return;

    setBusy(true);
    setStatus({state: 'loading', text: 'Resetting...'});
    try {
      await engine.ResetAsync();
      if (seed) {
        const loaded = JSON.parse(await execute(engine, seed, 'playground'));
        const failure = loaded.find((outcome) => !outcome.ok);
        if (failure) {
          throw new Error(`${failure.code}: ${failure.message}`);
        }
      }
      await refreshDatabases(engine, 'playground');
      setResults([]);
      setStatus({state: 'ready', text: 'Ready'});
    } catch (error) {
      setStatus({state: 'error', text: `Reset failed: ${error.message}`});
    } finally {
      setBusy(false);
    }
  }

  function chooseExample(example) {
    setSql(example.sql);
    setSelection({start: 0, end: 0});
    if (runExampleOnSelect) {
      run(example.sql);
    } else {
      setResults([]);
      setStatus((current) => (current.state === 'error' ? {state: 'ready', text: 'Ready'} : current));
    }
  }

  return (
    <section className={clsx(styles.playground, compact && styles.compact, className)}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>WebAssembly</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className={styles.headerControls}>
          <Status state={status.state} text={status.text} />
          <label className={styles.databaseControl}>
            <span>Database</span>
            <select
              value={database}
              onChange={(event) => setDatabase(event.target.value)}
              disabled={!engine || busy || !databases.length}>
              {databases.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className={styles.shell}>
        <div className={styles.editorPane}>
          <div className={styles.exampleBar} aria-label="Example queries">
            {examples.map((example) => (
              <button
                key={example.label}
                type="button"
                onClick={() => chooseExample(example)}
                disabled={!engine || busy}>
                {example.label}
              </button>
            ))}
          </div>

          <label className={styles.visuallyHidden} htmlFor="camus-playground-sql">
            SQL
          </label>
          <div className={styles.editorWrap}>
            <SqlLineNumbers code={sql} lineNumbersRef={lineNumbersRef} />
            <HighlightedSql code={sql} highlightRef={highlightRef} />
            <textarea
              ref={textareaRef}
              id="camus-playground-sql"
              value={sql}
              wrap={compact ? 'soft' : 'off'}
              spellCheck="false"
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => {
                setSql(event.target.value);
                updateSelection(event.currentTarget);
              }}
              onScroll={(event) => {
                syncEditorScroll(event.currentTarget, highlightRef, lineNumbersRef);
              }}
              onSelect={(event) => updateSelection(event.currentTarget)}
              onKeyUp={(event) => updateSelection(event.currentTarget)}
              onMouseUp={(event) => updateSelection(event.currentTarget)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  if (event.shiftKey) {
                    runSelected();
                  } else {
                    run();
                  }
                }
              }}
            />
          </div>

          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => run()}
              disabled={!engine || busy || !sql.trim()}>
              Run <kbd>{runKey}</kbd>
            </button>
            <button
              type="button"
              onClick={runSelected}
              disabled={!engine || busy || !selectedSql}>
              Run selected <kbd>Shift {runKey}</kbd>
            </button>
            <button type="button" onClick={reset} disabled={!engine || busy}>
              Reset data
            </button>
            {!compact && (
              <Link className={styles.docsLink} to="/docs/sql">
                SQL reference
              </Link>
            )}
          </div>
        </div>

        <div className={styles.resultsPane} aria-label="Results">
          {results.length ? (
            results.map((outcome, index) => <ResultCard outcome={outcome} key={`${index}-${outcome.sql}`} />)
          ) : (
            <EmptyResult>
              {engine
                ? 'Run a statement to see results here.'
                : 'The engine is loading. The first load downloads the WebAssembly runtime.'}
            </EmptyResult>
          )}
        </div>
      </div>

      <p className={styles.note}>
        Single-node, in-memory engine. Data stays in this tab and resets on reload.
      </p>
    </section>
  );
}
