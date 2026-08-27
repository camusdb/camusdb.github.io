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
      label: 'Start here',
      collapsed: false,
      items: [
        'intro',
        'why-camusdb',
        'databases',        
        'database-branching',        
        'recover-dropped-objects',
      ],
    },
    {
      type: 'category',
      label: 'SQL',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'sql',
          label: 'SQL overview',
        },
        'data-types',
        {
          type: 'category',
          label: 'Schema',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sql-schema',
              label: 'Tables and columns',
            },
            'check-constraints',
            'sql-indexes',
            {
              type: 'doc',
              id: 'comment-on',
              label: 'Schema comments',
            },
          ],
        },
        {
          type: 'category',
          label: 'Writing data',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sql-writes',
              label: 'Insert, update, delete',
            },
            {
              type: 'doc',
              id: 'insert-select-and-ctas',
              label: 'Copying query results',
            },
            {
              type: 'doc',
              id: 'truncate-table',
              label: 'Emptying a table',
            },
          ],
        },
        {
          type: 'category',
          label: 'Reading data',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sql-queries',
              label: 'SELECT',
            },
            'joins-and-subqueries',
            'vector-search',
            'time-travel-reads',
            {
              type: 'doc',
              id: 'sql-fromless-select',
              label: 'SELECT without FROM',
            },
          ],
        },
        {
          type: 'category',
          label: 'Views',
          collapsed: false,
          items: [
            'views',
            'materialized-views',
          ],
        },
        {
          type: 'category',
          label: 'Functions',
          collapsed: true,
          items: [
            {
              type: 'doc',
              id: 'functions',
              label: 'Overview',
            },
            'functions-session',
            'functions-string',
            'functions-math',
            'functions-datetime',
            'functions-json',
            'functions-regex',
            'functions-conversion',
            'functions-null',
            'functions-uuid',
            'functions-object-id',
          ],
        },
        {
          type: 'doc',
          id: 'sql-transactions',
          label: 'Transactions in SQL',
        },
        {
          type: 'category',
          label: 'Query performance',
          collapsed: false,
          items: [
            'query-planning',
            {
              type: 'doc',
              id: 'explain',
              label: 'EXPLAIN',
            },
            {
              type: 'doc',
              id: 'show-statistics',
              label: 'SHOW STATISTICS',
            },
            {
              type: 'doc',
              id: 'query-result-cache',
              label: 'Result cache',
            },
            {
              type: 'doc',
              id: 'distributed-queries',
              label: 'Distributed queries',
            },
          ],
        },
        {
          type: 'doc',
          id: 'prepared-statements',
          label: 'Parameters and prepared statements',
        },
        {
          type: 'doc',
          id: 'sql-inspection',
          label: 'Inspecting the database',
        },
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Transactions',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'serializable-transactions',
              label: 'Transactions and isolation',
            },
            {
              type: 'doc',
              id: 'serializable-retries',
              label: 'Retries and conflicts',
            },
            'transaction-limits',
            'transaction-priority',
            'distributed-transactions',
          ],
        },
        {
          type: 'category',
          label: 'Deployment',
          collapsed: false,
          items: [
            'cluster',
            'configuration',
            {
              type: 'doc',
              id: 'runtime-cluster-settings',
              label: 'Runtime cluster settings',
            },
            {
              type: 'doc',
              id: 'sql-authentication',
              label: 'Authentication and authorization',
            },
            {
              type: 'doc',
              id: 'backup-and-restore',
              label: 'Backup and restore',
            },
          ],
        },
        {
          type: 'category',
          label: 'Background jobs',
          collapsed: false,
          items: [
            'automatic-analyze',
            'row-level-ttl',
          ],
        },
        {
          type: 'category',
          label: 'Monitoring',
          collapsed: false,
          items: [
            'performance-diagnostics',
            'engine-stats',
            {
              type: 'doc',
              id: 'show-variables',
              label: 'SHOW VARIABLES',
            },
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Internals',
      collapsed: false,
      items: [
        'architecture',
        {
          type: 'category',
          label: 'Storage and durability',
          collapsed: false,
          items: [
            'storage',
            'wal-recovery',
            'spill-to-disk',
          ],
        },
        {
          type: 'category',
          label: 'Execution and concurrency',
          collapsed: false,
          items: [
            'query-planner-internals',
            'transactions-locking-internals',
            'distributed-schema',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'mcp-server',
        'web-console',
        'camus-cli',        
        'camus-dump',
        'workload-utility',
        'caraxes',
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
        'grpc-api',
      ],
    },
  ],
};

export default sidebars;
