// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import camusTheme from './src/prism/camusTheme.js';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'CamusDB',
  tagline: 'Open-source SQL distributed database',
  favicon: 'img/favicon.ico',

  // Set the production url of your site here
  url: 'https://camusdb.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',
  trailingSlash: true,

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'camusdb', // Usually your GitHub org/user name.
  projectName: 'docs', // Usually your repo name.

  onBrokenLinks: 'throw',
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  stylesheets: [
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap',
  ],

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          // Merged into the SELECT and joins pages during the SQL section rewrite.
          {from: '/docs/query-features', to: '/docs/sql-queries'},
          // Folded into the SQL overview.
          {from: '/docs/sql-comments', to: '/docs/sql'},
          // Merged into the prepared statements page.
          {from: '/docs/sql-parameters', to: '/docs/prepared-statements'},
          // Merged into the date/time functions page.
          {from: '/docs/functions-date-patterns', to: '/docs/functions-datetime'},
          // Folded into the cluster page during the operations section rewrite.
          {from: '/docs/multi-active-availability', to: '/docs/cluster'},
        ],
      },
    ],
  ],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl:
            'https://github.com/camusdb/camusdb.github.io/tree/main/',
        },
        blog: {
          showReadingTime: true,
          editUrl:
            'https://github.com/camusdb/camusdb.github.io/tree/main/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/camusdb-social-card.png',
      navbar: {
        title: 'CamusDB',
        logo: {
          alt: 'CamusDB logo',
          src: 'img/camusdb-logo.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            to: '/blog',
            label: 'Blog',
            position: 'left',
          },
          {
            to: '/playground',
            label: 'Playground',
            position: 'left',
          },
          {
            href: 'https://github.com/camusdb/camusdb',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Get started',
            items: [
              {label: 'Install CamusDB', to: '/docs/intro'},
              {label: 'Why CamusDB?', to: '/docs/why-camusdb'},
              {label: 'Try it in the browser', to: '/playground'},
              {label: 'Kubernetes Operator', to: '/docs/kubernetes-operator'},
              {label: 'Architecture', to: '/docs/architecture'},
            ],
          },
          {
            title: 'Features',
            items: [
              {label: 'Serializable transactions', to: '/docs/serializable-transactions'},
              {label: 'Cluster mode', to: '/docs/cluster'},
              {label: 'Query planning', to: '/docs/query-planning'},
              {label: 'Database branching', to: '/docs/database-branching'},
              {label: 'Time-travel reads', to: '/docs/time-travel-reads'},
              {label: 'Vector search', to: '/docs/vector-search'},
            ],
          },
          {
            title: 'Connect',
            items: [
              {label: '.NET driver', to: '/docs/dotnet-driver'},
              {label: 'EF Core provider', to: '/docs/ef-core'},
              {label: 'TypeScript connector', to: '/docs/typescript-connector'},
              {label: 'HTTP API', to: '/docs/http-api'},
              {label: 'MCP server', to: '/docs/mcp-server'},
            ],
          },
          {
            title: 'Project',
            items: [
              {label: 'GitHub', href: 'https://github.com/camusdb/camusdb'},
              {label: 'Caraxes Jepsen tests', to: '/docs/caraxes'},
              {label: 'Blog', to: '/blog'},
            ],
          },
        ],
        copyright: `Copyright © 2021-${new Date().getFullYear()} CamusDB.`,
      },
      // Colors per color mode live in src/theme/Mermaid/index.js.
      mermaid: {
        theme: {light: 'base', dark: 'base'},
        options: {
          // Flat boxes without the drop shadows of the 'neo' look.
          look: 'classic',
          // Keep short node labels on one line.
          // The extra margin keeps a subgraph title clear of its first node.
          flowchart: {padding: 16, wrappingWidth: 220, subGraphTitleMargin: {top: 6, bottom: 10}},
          // Narrow, wrapped sequence diagrams keep their text legible when
          // scaled to the content column.
          sequence: {
            wrap: true,
            width: 130,
            actorMargin: 40,
            mirrorActors: false,
            actorFontSize: 15,
            messageFontSize: 15,
            noteFontSize: 14,
          },
        },
      },
      prism: {
        theme: camusTheme,
        darkTheme: camusTheme,
        additionalLanguages: ['csharp', 'json'],
      },
    }),
};

export default config;
