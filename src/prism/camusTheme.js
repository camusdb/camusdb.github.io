// Prism theme that matches the SQL examples on the front page (see the
// .sqlSnippet palette in src/pages/index.module.css). Code blocks use the
// same dark editor surface in both site themes.

/** @type {import('prism-react-renderer').PrismTheme} */
const camusTheme = {
  plain: {
    color: '#e2e8f0',
    backgroundColor: '#0b1120',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: {color: '#64748b', fontStyle: 'italic'},
    },
    {
      types: ['keyword', 'atrule', 'selector', 'tag', 'important'],
      style: {color: '#c4b5fd', fontWeight: '500'},
    },
    {
      types: ['function', 'property', 'attr-name'],
      style: {color: '#7dd3fc'},
    },
    {
      types: ['string', 'char', 'attr-value', 'regex', 'url', 'inserted'],
      style: {color: '#86efac'},
    },
    {
      types: ['number', 'boolean', 'constant', 'symbol'],
      style: {color: '#fdba74'},
    },
    {
      types: ['builtin', 'class-name'],
      style: {color: '#5eead4'},
    },
    {
      types: ['variable', 'parameter'],
      style: {color: '#60a5fa'},
    },
    {
      types: ['operator', 'punctuation'],
      style: {color: '#94a3b8'},
    },
    {
      types: ['deleted'],
      style: {color: '#fca5a5'},
    },
    {
      types: ['namespace'],
      style: {opacity: 0.7},
    },
  ],
};

export default camusTheme;
