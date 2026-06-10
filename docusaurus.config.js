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
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

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
      image: 'img/docusaurus-social-card.jpg',
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
                label: 'camus-cli',
                to: '/docs/camus-cli',
              },
              {
                label: 'SQL',
                to: '/docs/sql',
              },
              {
                label: 'Query Features',
                to: '/docs/query-features',
              },
              {
                label: 'Functions',
                to: '/docs/functions',
              },
              {
                label: 'Serializable Transactions',
                to: '/docs/serializable-transactions',
              },
              {
                label: 'Multi-Active Availability',
                to: '/docs/multi-active-availability',
              },
              {
                label: 'HTTP API',
                to: '/docs/http-api',
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
