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
