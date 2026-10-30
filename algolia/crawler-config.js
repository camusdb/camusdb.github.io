/*
 * Algolia Crawler configuration for the CamusDB documentation site.
 *
 * This file is a checked-in copy for review and version history. The live
 * configuration is edited in the Algolia dashboard:
 *   Data Sources -> Crawler -> Editor.
 *
 * Paste the object below over the default "Experiences" config that the
 * onboarding flow generates. The default emits generic page records
 * ({ url, title, description, headers, content }); Docusaurus search needs
 * DocSearch records ({ hierarchy.lvl0..lvl6, content, anchor, type }).
 *
 * The `apiKey` field below is intentionally a placeholder. The crawler key is
 * write-capable - keep it in the dashboard, never in this repository.
 *
 * `initialIndexSettings` below applies only when the crawler creates the
 * index. To change the settings of the existing index, edit
 * algolia/index-settings.json (keep it in sync with the block below) and run
 * algolia/apply-index-settings.mjs.
 *
 * Selectors are grounded in the generated HTML: the page title is
 * `<article><header><h1>` on both docs and blog posts, and body copy lives in
 * `article p` / `article li`. Blog list pages hold one <article> per post, so
 * they are excluded to keep each post from being indexed several times.
 */

new Crawler({
  appId: "SPBBUBI3JT",
  apiKey: "<crawler API key - set in the dashboard, do not commit>",
  indexPrefix: "",
  rateLimit: 8,
  maxUrls: 1000,
  schedule: "every 1 day at 3:00 am",
  startUrls: ["https://camusdb.github.io/"],
  sitemaps: ["https://camusdb.github.io/sitemap.xml"],
  discoveryPatterns: ["https://camusdb.github.io/**"],
  exclusionPatterns: [
    "https://camusdb.github.io/blog/",
    "https://camusdb.github.io/blog/page/**",
    "https://camusdb.github.io/blog/tags/**",
    "https://camusdb.github.io/blog/authors/**",
    "https://camusdb.github.io/blog/archive/",
    "https://camusdb.github.io/search/",
  ],
  saveBackup: false,
  ignoreQueryParams: ["source", "utm_*"],
  ignoreCanonicalTo: true,
  actions: [
    {
      indexName: "camusdb_github_io_spbbubi3jt_pages",
      pathsToMatch: ["https://camusdb.github.io/**"],
      recordExtractor: ({ $, helpers, url }) => {
        const records = helpers.docsearch({
          recordProps: {
            lvl0: {
              selectors: "",
              defaultValue: url.pathname.startsWith("/blog/") ? "Blog" : "Documentation",
            },
            lvl1: "header h1",
            lvl2: "article h2",
            lvl3: "article h3",
            lvl4: "article h4",
            lvl5: "article h5, article td:first-child",
            lvl6: "article h6",
            content: "article p, article li, article td:last-child",
          },
          aggregateContent: true,
          recordVersion: "v3",
        });

        // A table row yields a heading record for its first cell and a
        // content record for its last cell, with the same hierarchy. Drop the
        // heading copy: the configuration reference otherwise exceeds the
        // crawler's limit of 750 records per page.
        const withContent = new Set(
          records
            .filter((r) => r.type === "content")
            .map((r) => JSON.stringify(r.hierarchy)),
        );

        // aggregateContent merges a whole section into one record, and the
        // record also stores content_camel, a second copy of the text. Split
        // long sections so each record stays under the 10 KB record limit.
        const maxContent = 3000;

        return records
          .filter((r) => !(r.type === "lvl5" && withContent.has(JSON.stringify(r.hierarchy))))
          .flatMap((r) => {
            if (!r.content || r.content.length <= maxContent) return [r];
            const parts = [];
            for (let i = 0; i < r.content.length; i += maxContent) {
              parts.push({
                ...r,
                objectID: `${r.objectID}-${parts.length}`,
                content: r.content.slice(i, i + maxContent),
                content_camel: undefined,
              });
            }
            return parts;
          });
      },
    },
  ],
  initialIndexSettings: {
    camusdb_github_io_spbbubi3jt_pages: {
      attributesForFaceting: ["type", "lang", "language", "version", "docusaurus_tag"],
      attributesToRetrieve: [
        "hierarchy",
        "content",
        "anchor",
        "url",
        "url_without_anchor",
        "type",
      ],
      attributesToHighlight: ["hierarchy", "content"],
      attributesToSnippet: ["content:10"],
      camelCaseAttributes: ["hierarchy", "content"],
      searchableAttributes: [
        "unordered(hierarchy.lvl0)",
        "unordered(hierarchy.lvl1)",
        "unordered(hierarchy.lvl2)",
        "unordered(hierarchy.lvl3)",
        "unordered(hierarchy.lvl4)",
        "unordered(hierarchy.lvl5)",
        "unordered(hierarchy.lvl6)",
        "content",
      ],
      distinct: true,
      attributeForDistinct: "url",
      customRanking: [
        "desc(weight.pageRank)",
        "desc(weight.level)",
        "asc(weight.position)",
      ],
      ranking: [
        "words",
        "filters",
        "typo",
        "attribute",
        "proximity",
        "exact",
        "custom",
      ],
      highlightPreTag: '<span class="algolia-docsearch-suggestion--highlight">',
      highlightPostTag: "</span>",
      minWordSizefor1Typo: 3,
      minWordSizefor2Typos: 7,
      allowTyposOnNumericTokens: false,
      minProximity: 1,
      ignorePlurals: true,
      advancedSyntax: true,
      attributeCriteriaComputedByMinProximity: true,
      removeWordsIfNoResults: "allOptional",
      separatorsToIndex: "_",
    },
  },
});
