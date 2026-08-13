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
          label: 'SQL Overview',
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
              label: 'Tables And Columns',
            },
            'check-constraints',
            'sql-indexes',
            {
              type: 'doc',
              id: 'comment-on',
              label: 'Schema Comments',
            },
          ],
        },
        {
          type: 'category',
          label: 'Writing Data',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sql-writes',
              label: 'Insert, Update, Delete',
            },
            {
              type: 'doc',
              id: 'insert-select-and-ctas',
              label: 'Copying Query Results',
            },
          ],
        },
        {
          type: 'category',
          label: 'Reading Data',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sql-queries',
              label: 'SELECT',
            },
            'joins-and-subqueries',
            'time-travel-reads',
            {
              type: 'doc',
              id: 'sql-fromless-select',
              label: 'SELECT Without FROM',
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
          label: 'Transactions In SQL',
        },
        {
          type: 'category',
          label: 'Query Performance',
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
              id: 'query-result-cache',
              label: 'Result Cache',
            },
          ],
        },
        {
          type: 'doc',
          id: 'prepared-statements',
          label: 'Parameters And Prepared Statements',
        },
        {
          type: 'doc',
          id: 'sql-inspection',
          label: 'Inspecting The Database',
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
              label: 'Transactions And Isolation',
            },
            {
              type: 'doc',
              id: 'serializable-retries',
              label: 'Retries And Conflicts',
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
              id: 'sql-authentication',
              label: 'Authentication And Authorization',
            },
            {
              type: 'doc',
              id: 'backup-and-restore',
              label: 'Backup And Restore',
            },
          ],
        },
        {
          type: 'category',
          label: 'Background Jobs',
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
          label: 'Storage And Durability',
          collapsed: false,
          items: [
            'storage',
            'wal-recovery',
            'spill-to-disk',
          ],
        },
        {
          type: 'category',
          label: 'Execution And Concurrency',
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
