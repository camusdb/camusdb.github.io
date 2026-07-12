/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */

// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Start Here',
      collapsed: false,
      items: [
        'intro',
        'databases',
        'database-branching',
        'why-camusdb',
      ],
    },
    {
      type: 'category',
      label: 'SQL And Queries',
      collapsed: false,
      items: [
        'sql',
        'sql-comments',
        'sql-schema',
        'data-types',
        'sql-indexes',
        'sql-writes',
        'sql-queries',
        'query-features',
        'query-planning',
        'query-result-cache',
        {
          type: 'doc',
          id: 'explain',
          label: 'Explaining Queries And Commands',
        },
        'sql-transactions',
        'sql-inspection',
        'sql-parameters',
        {
          type: 'category',
          label: 'Functions',
          collapsed: false,
          items: [
            'functions',
            'functions-string',
            'functions-math',
            'functions-datetime',
            'functions-json',
            'functions-conversion',
            'functions-null',
            'functions-uuid',
            'functions-object-id',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Distributed Operation',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'serializable-transactions',
          label: 'Transactions And Isolation',
        },
        'transaction-limits',
        'serializable-retries',
        'distributed-transactions',
        'multi-active-availability',
        'cluster',
        'configuration',
      ],
    },
    {
      type: 'category',
      label: 'Storage And Internals',
      collapsed: false,
      items: [
        'architecture',
        {
          type: 'category',
          label: 'Internals',
          collapsed: false,
          items: [
            'storage',
            'wal-recovery',
            'distributed-schema',
            'query-planning',
            'query-planner-internals',
            'spill-to-disk',
            'transactions-locking-internals',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'camus-cli',
        'camus-dump',
        {
          type: 'category',
          label: '.NET',
          collapsed: false,
          items: [
            'dotnet-driver',
            'ef-core',
          ],
        },
        'error-codes',
        'http-api',
      ],
    },
  ],
};

export default sidebars;
