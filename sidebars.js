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
      ],
    },
    {
      type: 'category',
      label: 'SQL And Queries',
      collapsed: false,
      items: [
        'sql',
        'query-features',
        'query-planning',
        {
          type: 'doc',
          id: 'explain',
          label: 'Explaining Queries And Commands',
        },
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
        'serializable-transactions',
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
        'storage',
        'wal-recovery',
        'distributed-schema',
        'query-planner-internals',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'camus-cli',
        {
          type: 'category',
          label: '.NET',
          collapsed: false,
          items: [
            'dotnet-driver',
            'ef-core',
          ],
        },
        'camus-dump',
        'error-codes',
        'http-api',
      ],
    },
  ],
};

export default sidebars;
