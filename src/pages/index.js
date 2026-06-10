import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const heroPillars = [
  {
    title: 'Scales writes across nodes',
    detail: 'No manual sharding — data is partitioned for you.',
  },
  {
    title: 'Stays online through failures',
    detail: 'Raft replication keeps the cluster serving when a node drops.',
  },
  {
    title: 'Serializable by default',
    detail: 'Strong consistency, so your invariants always hold.',
  },
];

function HomepageHeader() {
  const logoUrl = useBaseUrl('/img/camusdb-logo-mark.png');

  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <p className={styles.eyebrow}>Open-source distributed SQL database</p>
        <img className={styles.heroLogo} src={logoUrl} alt="CamusDB logo" />
        <Heading as="h1" className={styles.title}>
          The SQL database that scales itself
        </Heading>
        <p className={styles.subtitle}>
          Write ordinary SQL. CamusDB spreads it across a cluster that scales
          writes, survives node failures, and keeps every transaction
          serializable — no sharding, no eventual-consistency surprises.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/intro">
            Start the tutorial
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/why-camusdb">
            Why CamusDB?
          </Link>
        </div>
        <div className={styles.heroPillars}>
          {heroPillars.map((pillar) => (
            <div className={styles.heroPillar} key={pillar.title}>
              <span className={styles.heroPillarTitle}>{pillar.title}</span>
              <span className={styles.heroPillarDetail}>{pillar.detail}</span>
            </div>
          ))}
        </div>
        <div className={styles.heroSnippet}>
          <CodeBlock language="sql">{`CREATE TABLE orders (id OID PRIMARY KEY, sku STRING, qty INT64);

BEGIN;
  UPDATE stock SET qty = qty - 1 WHERE sku = "A-100";
  INSERT INTO orders VALUES (GEN_ID(), "A-100", 1);
COMMIT;  -- serializable across the whole cluster`}</CodeBlock>
        </div>
      </div>
    </header>
  );
}

const advantages = [
  {
    label: 'Traditional databases',
    items: [
      'A single primary node often becomes the write bottleneck.',
      'Failover can require promotion, reconnection, and operational intervention.',
      'Scaling writes commonly means manual sharding or application-side routing.',
      'Lower isolation levels can expose concurrency anomalies unless the app compensates.',
    ],
  },
  {
    label: 'CamusDB',
    items: [
      'Multiple nodes can accept client traffic while partitions route writes to their leaders.',
      'Raft consensus elects leaders per partition and replicates committed writes.',
      'Data is partitioned across the cluster instead of tied to one process.',
      'Serializable transactions are the default, with two-phase commit for cross-partition writes.',
    ],
  },
];

const consistencyComparison = [
  {
    label: 'Strong consistency',
    items: [
      'Reads observe committed state instead of waiting for replicas to catch up.',
      'Applications can enforce invariants without stitching around stale reads.',
      'Failover does not silently trade correctness for temporary divergence.',
      'Transactions and constraints stay meaningful across nodes, not just on one machine.',
    ],
  },
  {
    label: 'Eventual or weaker consistency',
    items: [
      'A read can return older data even after another client committed a write.',
      'Conflict resolution often moves into application code and background repair.',
      'Cross-row or cross-entity business rules become harder to enforce safely.',
      'Operational simplicity at the storage layer can become correctness complexity in the app.',
    ],
  },
];

function AdvantageComparison() {
  return (
    <section className={styles.comparison}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.eyebrow}>Why distributed NewSQL?</p>
          <Heading as="h2">Built beyond the single-primary model</Heading>
          <p>
            CamusDB keeps the familiar relational workflow while moving storage,
            replication, and transaction coordination into a distributed cluster.
          </p>
        </div>
        <div className={styles.comparisonGrid}>
          {advantages.map((column) => (
            <div className={styles.comparisonPanel} key={column.label}>
              <Heading as="h3">{column.label}</Heading>
              <ul>
                {column.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={styles.consistencySection}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Consistency model</p>
            <Heading as="h2">Why strong consistency matters</Heading>
            <p>
              Distributed databases do not all make the same correctness tradeoff.
              CamusDB is designed around strongly consistent committed state
              instead of eventual convergence as the default application model.
            </p>
          </div>
          <div className={styles.comparisonGrid}>
            {consistencyComparison.map((column) => (
              <div className={styles.comparisonPanel} key={column.label}>
                <Heading as="h3">{column.label}</Heading>
                <ul>
                  {column.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className={styles.examplePanel}>
            <Heading as="h3">Practical example: one item left in stock</Heading>
            <p>
              Two buyers place an order for the last available item at nearly the
              same time. With stale reads or eventually consistent replicas, both
              requests can see stock available and both can try to commit,
              forcing the application to repair oversold inventory later.
            </p>
            <ul>
              <li>With strong consistency, the second transaction sees the committed change or is forced to retry.</li>
              <li>The database protects the inventory invariant at commit time instead of leaving it to asynchronous repair.</li>
              <li>The application logic stays simpler because correctness does not depend on reading from the “right” replica.</li>
            </ul>
          </div>
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
      description="CamusDB documentation for SQL, indexes, transactions, and distributed clusters.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <AdvantageComparison />
      </main>
    </Layout>
  );
}
