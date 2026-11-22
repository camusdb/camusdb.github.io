const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const vm = require('node:vm');
const Prism = require('prismjs');
require('prismjs/components/prism-sql');

const grammar = fs.readFileSync('src/theme/prism-include-languages.js', 'utf8');
vm.runInNewContext(
  grammar.slice(grammar.indexOf('const camusSqlKeywords'), grammar.indexOf('export default'))
    + '\nregisterCamusSql(Prism);',
  {Prism, require},
);
const editor = fs.readFileSync('src/components/CamusPlayground/index.js', 'utf8');
const tokenizeSql = vm.runInNewContext(
  editor.slice(editor.indexOf('const sqlKeywords'), editor.indexOf('export function HighlightedSql'))
    + '\ntokenizeSql;',
);

function flatten(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flatten).join('');
  return flatten(value.content);
}

function tokens(sql) {
  return [
    Prism.tokenize(sql, Prism.languages.camussql).map((token) => ({
      kind: typeof token === 'string' ? 'plain' : token.type,
      value: flatten(token),
    })),
    Array.from(tokenizeSql(sql)),
  ];
}

function expectToken(stream, kind, value) {
  expect(stream.some((token) => token.kind === kind && token.value === value)).toBe(true);
}

test('inline C# declaration keywords stay outside raw dollar-quoted bodies', () => {
  const body = '$$\n  // SELECT is body text, not a SQL comment\n  return s.Replace(";", "SELECT");\n$$';
  const sql = `CREATE FUNCTION clean(s STRING) RETURNS STRING CALLED ON NULL INPUT LANGUAGE csharp AS ${body};\nSHOW FUNCTIONS; SHOW TRIGGERS;`;
  for (const stream of tokens(sql)) {
    expect(stream.map((token) => token.value).join('')).toBe(sql);
    expectToken(stream, 'string', body);
    for (const word of ['CREATE', 'FUNCTION', 'RETURNS', 'CALLED', 'INPUT', 'LANGUAGE', 'FUNCTIONS', 'TRIGGERS']) {
      expectToken(stream, 'keyword', word);
    }
    expect(stream.some((token) => token.kind === 'keyword' && token.value === 'SELECT')).toBe(false);
  }
});

test('tagged bodies keep other tags, quotes, and comments as raw text', () => {
  const body = '$body$\n  string value = "$$ $BODY$ /* SELECT */";\n  return value;\n$body$';
  const sql = `CREATE FUNCTION text_value() RETURNS STRING LANGUAGE csharp AS ${body};`;
  for (const stream of tokens(sql)) {
    expect(stream.map((token) => token.value).join('')).toBe(sql);
    expectToken(stream, 'string', body);
  }
});

test('dollar quotes inside ordinary SQL strings and comments do not start bodies', () => {
  for (const [sql, kind, value] of [
    ["SELECT '$$ SELECT $$';", 'string', "'$$ SELECT $$'"],
    ['-- $fn$ SELECT $fn$\nSELECT 1;', 'comment', '-- $fn$ SELECT $fn$'],
    ['/* $$ SELECT $$ */ SELECT 1;', 'comment', '/* $$ SELECT $$ */'],
    ['SELECT `FUNCTION`, 2 ^ 3;', 'identifier', '`FUNCTION`'],
  ]) {
    for (const stream of tokens(sql)) {
      expect(stream.map((token) => token.value).join('')).toBe(sql);
      expectToken(stream, kind, value);
    }
  }
  expectToken(Array.from(tokenizeSql('AS $fn$ return "unfinished";')), 'string', '$fn$ return "unfinished";');
});


test('interval literals and casts preserve unreserved identifiers', () => {
  for (const sql of ["SELECT INTERVAL '1 day';", 'SELECT INTERVAL 3 HOUR;', 'SELECT INTERVAL @n DAY;']) {
    for (const stream of tokens(sql)) expectToken(stream, 'keyword', 'INTERVAL');
  }
  for (const sql of ["SELECT CAST('1 day' AS INTERVAL);", "SELECT '1 day'::INTERVAL;"]) {
    const [prism, editor] = tokens(sql);
    expectToken(prism, 'builtin', 'INTERVAL');
    expectToken(editor, 'type', 'INTERVAL');
  }
  for (const stream of tokens('SELECT interval FROM measurements;')) {
    expect(stream.some((token) => token.kind !== 'plain' && token.value.toUpperCase() === 'INTERVAL')).toBe(false);
  }
});

test('interval functions highlight without changing strings or comments', () => {
  const sql = "SELECT age(x), make_interval(), justify_days(x), justify_hours(x), justify_interval(x), date_bin(x, y, z), 'INTERVAL age'; -- INTERVAL date_bin";
  for (const stream of tokens(sql)) {
    expect(stream.map((token) => token.value).join('')).toBe(sql);
    for (const name of ['age', 'make_interval', 'justify_days', 'justify_hours', 'justify_interval', 'date_bin']) {
      expectToken(stream, 'function', name);
    }
    expectToken(stream, 'string', "'INTERVAL age'");
    expectToken(stream, 'comment', '-- INTERVAL date_bin');
  }
});


test('trigonometric functions and angle conversions highlight in both grammars', () => {
  const names = ['sin', 'cos', 'tan', 'cot', 'asin', 'acos', 'atan', 'atan2',
    'sind', 'cosd', 'tand', 'cotd', 'asind', 'acosd', 'atand', 'atan2d',
    'radians', 'degrees', 'pi'];
  const sql = `SELECT ${names.map((name) => `${name}(${name === 'pi' ? '' : name.startsWith('atan2') ? '1, 1' : '0.5'})`).join(', ')}, 'sind radians'; -- cotd degrees`;
  for (const stream of tokens(sql)) {
    expect(stream.map((token) => token.value).join('')).toBe(sql);
    for (const name of names) expectToken(stream, 'function', name);
    expectToken(stream, 'string', "'sind radians'");
    expectToken(stream, 'comment', '-- cotd degrees');
  }
});


test('WITH queries and joined writes highlight supported SQL forms', () => {
  const sql = `WITH totals(account_id, amount) AS MATERIALIZED (
  SELECT account_id, sum(amount) FROM deltas GROUP BY account_id
), current_totals AS NOT MATERIALIZED (SELECT * FROM totals)
UPDATE accounts AS a SET balance = a.balance + d.amount
FROM current_totals AS d WHERE d.account_id = a.id RETURNING a.id;
DELETE FROM orders AS o USING customers AS c WHERE c.id = o.customer_id;
SELECT using_id, usings, \`using\`, 'WITH USING MATERIALIZED'; -- WITH USING`;
  for (const stream of tokens(sql)) {
    expect(stream.map((token) => token.value).join('')).toBe(sql);
    for (const word of ['WITH', 'AS', 'MATERIALIZED', 'NOT', 'UPDATE', 'FROM', 'DELETE', 'USING', 'RETURNING']) {
      expectToken(stream, 'keyword', word);
    }
    expectToken(stream, 'identifier', '`using`');
    expectToken(stream, 'string', "'WITH USING MATERIALIZED'");
    expectToken(stream, 'comment', '-- WITH USING');
    expect(stream.some((token) => token.kind === 'keyword' && /^(using_id|usings)$/.test(token.value))).toBe(false);
  }
});


test('recursive queries, lateral values and typed temporal literals highlight correctly', () => {
  const sql = `WITH RECURSIVE walk(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM walk WHERE n < 3)
SELECT v.d, TIMESTAMP '2026-11-16T12:00:00Z', recursive, lateral_id
FROM walk CROSS JOIN LATERAL (VALUES (DATE '2026-11-16', n)) AS v(d, value);
-- WITH RECURSIVE LATERAL
SELECT 'WITH RECURSIVE LATERAL';`;
  const [prism, editor] = tokens(sql);
  for (const stream of [prism, editor]) {
    expect(stream.map((token) => token.value).join('')).toBe(sql);
    for (const word of ['WITH', 'RECURSIVE', 'LATERAL', 'VALUES']) expectToken(stream, 'keyword', word);
    expectToken(stream, 'string', "'2026-11-16'");
    expectToken(stream, 'comment', '-- WITH RECURSIVE LATERAL');
    expectToken(stream, 'string', "'WITH RECURSIVE LATERAL'");
    expect(stream.some((token) => token.kind === 'keyword' && /^(recursive|lateral_id)$/.test(token.value))).toBe(false);
  }
  expectToken(prism, 'builtin', 'DATE');
  expectToken(prism, 'builtin', 'TIMESTAMP');
  expectToken(editor, 'type', 'DATE');
  expectToken(editor, 'type', 'TIMESTAMP');
});


test('GREATEST and LEAST highlight as functions without changing strings or comments', () => {
  const sql = "SELECT greatest(NULL, 2, 1), least(3, 2.5), greatest_value, 'greatest least'; -- greatest least";
  for (const stream of tokens(sql)) {
    expect(stream.map((token) => token.value).join('')).toBe(sql);
    expectToken(stream, 'function', 'greatest');
    expectToken(stream, 'function', 'least');
    expectToken(stream, 'string', "'greatest least'");
    expectToken(stream, 'comment', '-- greatest least');
    expect(stream.some((token) => token.kind === 'function' && token.value === 'greatest_value')).toBe(false);
  }
});

test('PARTITIONS is a keyword after SHOW and an identifier in queries', () => {
  const sql = "SHOW PARTITIONS; SELECT partitions FROM partitions WHERE note = 'SHOW PARTITIONS'; -- SHOW PARTITIONS";
  for (const stream of tokens(sql)) {
    expect(stream.map((token) => token.value).join('')).toBe(sql);
    expectToken(stream, 'keyword', 'PARTITIONS');
    expectToken(stream, 'string', "'SHOW PARTITIONS'");
    expectToken(stream, 'comment', '-- SHOW PARTITIONS');
    const partitionKeywords = stream.filter(
      (token) => token.kind === 'keyword' && /^partitions$/i.test(token.value),
    );
    expect(partitionKeywords).toHaveLength(1);
  }
});
