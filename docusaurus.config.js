// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'CamusDB',
  tagline: 'Open-source NewSQL distributed database',
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
            title: 'Docs',
            items: [
              {
                label: 'Getting Started',
                to: '/docs/intro',
              },
              {
                label: 'Why CamusDB?',
                to: '/docs/why-camusdb',
              },
              {
                label: 'Databases',
                to: '/docs/databases',
              },
              {
                label: 'camus-cli',
                to: '/docs/camus-cli',
              },
              {
                label: 'SQL',
                to: '/docs/sql',
              },
              {
                label: 'SELECT',
                to: '/docs/sql-queries',
              },
              {
                label: 'Joins And Subqueries',
                to: '/docs/joins-and-subqueries',
              },
              {
                label: 'Functions',
                to: '/docs/functions',
              },
              {
                label: 'Transactions And Isolation',
                to: '/docs/serializable-transactions',
              },
              {
                label: 'Cluster Mode',
                to: '/docs/cluster',
              },
              {
                label: 'HTTP API',
                to: '/docs/http-api',
              },
              {
                label: 'gRPC API',
                to: '/docs/grpc-api',
              },
              {
                label: '.NET Driver',
                to: '/docs/dotnet-driver',
              },
              {
                label: 'EF Core Provider',
                to: '/docs/ef-core',
              },
              {
                label: 'camus-dump',
                to: '/docs/camus-dump',
              },
              {
                label: 'Cluster',
                to: '/docs/cluster',
              },
              {
                label: 'Configuration',
                to: '/docs/configuration',
              },
              {
                label: 'Storage',
                to: '/docs/storage',
              },
              {
                label: 'WAL & Recovery',
                to: '/docs/wal-recovery',
              },
              {
                label: 'Architecture',
                to: '/docs/architecture',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'Source',
                href: 'https://github.com/camusdb/camusdb',
              },
              {
                label: 'Docs Repo',
                href: 'https://github.com/camusdb/camusdb.github.io',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} CamusDB.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['csharp'],
      },
    }),
};

export default config;
