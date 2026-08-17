import clsx from 'clsx';
import {useState} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const heroProofs = [
  {
    title: 'Multi-active access',
    detail: 'Every cluster node can expose the database API.',
  },
  {
    title: 'Serializable by default',
    detail: 'Transactions coordinate atomic writes across partitions.',
  },
  {
    title: 'Copy-on-write branches',
    detail: 'Test changes without writing to the source database.',
  },
];

const outcomes = [
  {
    label: 'Scale',
    title: 'Spend less time on sharding logic',
    detail:
      'CamusDB partitions data and routes writes to the Raft leader that owns each key range.',
    link: '/docs/cluster',
    linkLabel: 'Explore cluster mode',
  },
  {
    label: 'Correctness',
    title: 'Keep concurrency rules in the database',
    detail:
      'Committed reads, conflict detection, and Serializable transactions help protect application invariants.',
    link: '/docs/serializable-transactions',
    linkLabel: 'Review transaction guarantees',
  },
  {
    label: 'Safety',
    title: 'Make risky changes easier to reverse',
    detail:
      'Branch a database before an experiment, or relink a root database or table while its drop is still retained.',
    link: '/docs/database-branching',
    linkLabel: 'See database branching',
    secondaryLink: '/docs/recover-dropped-objects',
    secondaryLinkLabel: 'See drop recovery',
  },
];

const sqlExamples = [
  {
    id: 'consistency',
    label: 'Consistency',
    title: 'Commit related writes together',
    detail:
      'Serializable is the default. Make it explicit when two updates must behave as one atomic transaction.',
    link: '/docs/serializable-transactions',
    linkLabel: 'Read the consistency guide',
    code: `BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

UPDATE accounts SET balance = balance - 100 WHERE id = "A";
UPDATE accounts SET balance = balance + 100 WHERE id = "B";

COMMIT;`,
  },
  {
    id: 'recovery',
    label: 'Recover tables',
    title: 'Relink a retained table',
    detail:
      'A normal drop can be reversed during the configured retention window using the orphan id returned by CamusDB.',
    link: '/docs/recover-dropped-objects',
    linkLabel: 'Read the recovery guide',
    code: `DROP TABLE orders;
SHOW ORPHAN TABLES;

-- "A0" comes from SHOW ORPHAN TABLES.
CREATE TABLE orders_recovered RELINK TO "A0";
SELECT * FROM orders_recovered LIMIT 5;`,
  },
  {
    id: 'time-travel',
    label: 'Time travel',
    title: 'Read a historical snapshot',
    detail:
      'Inspect what a query returned before a change, without restoring a backup or blocking current writers.',
    link: '/docs/time-travel-reads',
    linkLabel: 'Read the time-travel guide',
    code: `SELECT id, status, total
FROM orders AS OF SYSTEM TIME '-10m'
WHERE status = "paid"
ORDER BY total DESC
LIMIT 10;

-- Compare with the latest committed data.
SELECT id, status, total
FROM orders
WHERE status = "paid"
ORDER BY total DESC
LIMIT 10;`,
  },
  {
    id: 'branching',
    label: 'Branching',
    title: 'Test without changing the source',
    detail:
      'Create a point-in-time copy-on-write branch, then keep its schema and data changes isolated from the source.',
    link: '/docs/database-branching',
    linkLabel: 'Read the branching guide',
    code: `CREATE DATABASE checkout_test BRANCH FROM shop;
USE checkout_test;

ALTER TABLE orders ADD COLUMN audit_note STRING;
UPDATE orders SET audit_note = "migration test";

-- The shop database is unchanged.`,
  },
  {
    id: 'query-cache',
    label: 'Query cache',
    title: 'Opt repeated reads into the cache',
    detail:
      'Cache an eligible single-table autocommit query in memory on each node, with an explicit family and TTL.',
    link: '/docs/query-result-cache',
    linkLabel: 'Read the query-cache guide',
    code: `SELECT id, total
FROM orders {cache=recent_orders, ttl=30s}
WHERE status = "paid"
ORDER BY total DESC
LIMIT 20;

EVICT CACHE 'recent_orders';`,
  },
];

function DataBeam({className}) {
  return (
    <div className={clsx(styles.dataBeam, className)} aria-hidden="true">
      <b />
      <span />
      <i />
    </div>
  );
}

function PyramidNetwork({className}) {
  const pyramidUrl = useBaseUrl('/img/pyramid.png');

  return (
    <div
      className={clsx(styles.pyramidNetwork, className)}
      role="img"
      aria-label="Three database pyramids exchanging data streams">
      <DataBeam className={styles.dataBeamLeft} />
      <DataBeam className={styles.dataBeamRight} />
      <DataBeam className={styles.dataBeamBase} />
      <img
        className={clsx(styles.pyramidNode, styles.pyramidTop)}
        src={pyramidUrl}
        alt=""
        aria-hidden="true"
      />
      <img
        className={clsx(styles.pyramidNode, styles.pyramidLeft)}
        src={pyramidUrl}
        alt=""
        aria-hidden="true"
      />
      <img
        className={clsx(styles.pyramidNode, styles.pyramidRight)}
        src={pyramidUrl}
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}

function HomepageHeader() {
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <div className={styles.heroLayout}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>Open-source distributed SQL</span>
              <span className={styles.alphaBadge}>Alpha</span>
            </div>
            <Heading as="h1" className={styles.title}>
              Scale SQL writes across nodes without manual sharding
            </Heading>
            <p className={styles.subtitle}>
              CamusDB partitions data, routes writes through Raft, and runs
              Serializable transactions by default, while your application uses
              familiar SQL
            </p>
            <div className={styles.buttons}>
              <Link className="button button--primary button--lg" to="/docs/intro">
                Try CamusDB locally
              </Link>
              <Link className={styles.secondaryAction} to="/docs/why-camusdb">
                See how it works <span aria-hidden="true">→</span>
              </Link>
            </div>
            <p className={styles.statusNote}>
              <span className={styles.statusDot} aria-hidden="true" />
              Alpha software for evaluation, not production workloads yet
            </p>
          </div>
          <PyramidNetwork className={styles.heroNetwork} />
        </div>

        <div className={styles.proofGrid} aria-label="CamusDB highlights">
          {heroProofs.map((proof) => (
            <div className={styles.proofItem} key={proof.title}>
              <span className={styles.proofMark} aria-hidden="true">✓</span>
              <div>
                <strong>{proof.title}</strong>
                <span>{proof.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

function OutcomeSection() {
  return (
    <section className={styles.outcomes}>
      <div className="container">
        <div className={styles.sectionIntro}>
          <p className={styles.sectionEyebrow}>Why look closer</p>
          <Heading as="h2">Three practical reasons to explore CamusDB</Heading>
        </div>
        <div className={styles.outcomeGrid}>
          {outcomes.map((outcome) => (
            <article className={styles.outcomeCard} key={outcome.title}>
              <span className={styles.outcomeLabel}>{outcome.label}</span>
              <Heading as="h3">{outcome.title}</Heading>
              <p>{outcome.detail}</p>
              <div className={styles.cardLinks}>
                <Link to={outcome.link}>{outcome.linkLabel} <span aria-hidden="true">→</span></Link>
                {outcome.secondaryLink && (
                  <Link to={outcome.secondaryLink}>
                    {outcome.secondaryLinkLabel} <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FamiliarSqlSection() {
  const [activeExampleId, setActiveExampleId] = useState(sqlExamples[0].id);
  const activeExample =
    sqlExamples.find((example) => example.id === activeExampleId) ?? sqlExamples[0];

  return (
    <section className={styles.sqlSection}>
      <div className="container">
        <div className={styles.sqlGrid}>
          <div className={styles.sqlCopy}>
            <p className={styles.sectionEyebrow}>See it in SQL</p>
            <Heading as="h2">Explore real CamusDB workflows</Heading>
            <p className={styles.exampleSummary}>{activeExample.detail}</p>
            <div className={styles.exampleTabs} role="tablist" aria-label="SQL examples">
              {sqlExamples.map((example) => {
                const isActive = example.id === activeExample.id;
                return (
                  <button
                    className={clsx(styles.exampleTab, isActive && styles.exampleTabActive)}
                    id={`sql-tab-${example.id}`}
                    key={example.id}
                    type="button"
                    role="tab"
                    aria-controls={`sql-panel-${example.id}`}
                    aria-selected={isActive}
                    onClick={() => setActiveExampleId(example.id)}>
                    {example.label}
                  </button>
                );
              })}
            </div>
            <Link className={styles.exampleLink} to={activeExample.link}>
              {activeExample.linkLabel} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div
            className={styles.sqlSnippet}
            id={`sql-panel-${activeExample.id}`}
            role="tabpanel"
            aria-labelledby={`sql-tab-${activeExample.id}`}>
            <div className={styles.exampleHeader}>
              <span>{activeExample.label}</span>
              <strong>{activeExample.title}</strong>
            </div>
            <CodeBlock key={activeExample.id} language="camussql">
              {activeExample.code}
            </CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCallToAction() {
  return (
    <section className={styles.finalCta}>
      <div className={clsx('container', styles.finalCtaInner)}>
        <div>
          <p className={styles.sectionEyebrow}>Evaluate it for yourself</p>
          <Heading as="h2">See whether CamusDB fits your use case</Heading>
          <p>Install the server from NuGet, run it locally, follow the tutorial, and review the current scope.</p>
        </div>
        <div className={styles.finalActions}>
          <Link className="button button--primary button--lg" to="/docs/intro">
            Start the tutorial
          </Link>
          <Link to="/docs/why-camusdb#current-scope">Review current scope</Link>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Explore CamusDB, an open-source alpha distributed SQL database with partitioned writes, Serializable transactions, database branching, and recoverable drops.">
      <HomepageHeader />
      <main>
        <OutcomeSection />
        <FamiliarSqlSection />
        <FinalCallToAction />
      </main>
    </Layout>
  );
}
