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
    title: 'Strong transactional guarantees',
    detail: 'Serializable transactions, committed reads, and atomic writes.',
  },
  {
    title: 'Copy-on-write database branches',
    detail: 'Clone a base database for testing and issue reproduction.',
  },
  {
    title: 'Recover accidental drops',
    detail: 'Relink dropped root databases and tables during retention.',
  },
  {
    title: 'AI-agent ready',
    detail: 'Expose schemas, queries, and controlled writes through MCP.',
  },
  {
    title: 'Flexible client protocols',
    detail: 'Use tools, REST/JSON, gRPC, or native client libraries.',
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
    <div className={clsx(styles.pyramidNetwork, className)} role="img" aria-label="Three database pyramids exchanging data streams">
      <div className={styles.networkGrid} aria-hidden="true" />
      <DataBeam className={styles.dataBeamLeft} />
      <DataBeam className={styles.dataBeamRight} />
      <DataBeam className={styles.dataBeamBase} />
      <img className={clsx(styles.pyramidNode, styles.pyramidTop)} src={pyramidUrl} alt="" aria-hidden="true" />
      <img className={clsx(styles.pyramidNode, styles.pyramidLeft)} src={pyramidUrl} alt="" aria-hidden="true" />
      <img className={clsx(styles.pyramidNode, styles.pyramidRight)} src={pyramidUrl} alt="" aria-hidden="true" />
    </div>
  );
}

function HomepageHeader() {
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <p className={styles.eyebrow}>Open-source distributed SQL database</p>
        <PyramidNetwork className={styles.heroNetwork} />
        <Heading as="h1" className={styles.title}>
          The SQL database that scales itself
        </Heading>
        <p className={styles.subtitle}>
          Write ordinary SQL. CamusDB spreads it across a cluster that scales
          writes, survives node failures, and runs transactions at Serializable
          isolation by default. Branch a database for feature work or issue
          reproduction without touching the source, recover accidental drops
          without a full restore, connect over REST/JSON or gRPC, or give AI
          agents controlled access through the CamusDB MCP server.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/intro">
            Start the tutorial
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/why-camusdb">
            Why CamusDB?
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/mcp-server">
            MCP Server
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
          <CodeBlock language="camussql">{`CREATE DATABASE shop;
USE shop;

CREATE TABLE orders (id OID PRIMARY KEY, sku STRING, qty INT64);

CREATE DATABASE checkout_repro BRANCH FROM shop;
USE checkout_repro;

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
      'Atomic distributed writes use two-phase commit, with Serializable as the default isolation level.',
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

const branchingUseCases = [
  'Develop features against a realistic database clone without coordinating shared fixtures.',
  'Reproduce production-only bugs in an isolated branch while the source keeps serving traffic.',
  'Run migration rehearsals and destructive tests, then drop the branch when the run is done.',
];

const recoveryUseCases = [
  'Recover from an accidental DROP DATABASE or DROP TABLE while the data is still retained.',
  'Undo a destructive migration or cleanup script by relinking the old object under a safe name.',
  'Inspect, audit, or compare dropped data after a new object reused the original name.',
  'Keep normal cleanup reversible, then use FORCE later only when permanent deletion is intentional.',
];

function BranchingWorkflow() {
  return (
    <section className={styles.branching}>
      <div className="container">
        <div className={styles.branchingGrid}>
          <div className={styles.branchingCopy}>
            <p className={styles.eyebrow}>Database branching</p>
            <Heading as="h2">Clone real data for confident development</Heading>
            <p>
              CamusDB can create an isolated point-in-time branch of a base
              database. The branch reads the source snapshot until it diverges,
              while its writes, deletes, and schema changes stay private.
            </p>
            <ul>
              {branchingUseCases.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link className="button button--secondary" to="/docs/database-branching">
              Read the branching guide
            </Link>
          </div>
          <div className={styles.branchingSnippet}>
            <CodeBlock language="camussql">{`CREATE DATABASE prod;
USE prod;

-- Create an instant copy-on-write branch.
CREATE DATABASE feature_checkout BRANCH FROM prod;
USE feature_checkout;

ALTER TABLE orders ADD COLUMN audit_note STRING;
UPDATE orders SET audit_note = "repro case";

-- prod is unchanged.
DROP DATABASE feature_checkout;`}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

function RecoveryWorkflow() {
  return (
    <section className={styles.branching}>
      <div className="container">
        <div className={styles.branchingGrid}>
          <div className={styles.branchingCopy}>
            <p className={styles.eyebrow}>Catastrophic recovery</p>
            <Heading as="h2">Dropped does not have to mean gone</Heading>
            <p>
              A normal drop removes the database or table from the active
              catalog immediately, but CamusDB can retain the data as a
              recoverable orphan for a configured retention window.
            </p>
            <ul>
              {recoveryUseCases.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link className="button button--secondary" to="/docs/recover-dropped-objects">
              Read the recovery guide
            </Link>
          </div>
          <div className={styles.branchingSnippet}>
            <CodeBlock language="camussql">{`USE shop;

DROP TABLE orders;
SHOW ORPHAN TABLES;

CREATE TABLE orders_recovered RELINK TO "A0";
SELECT * FROM orders_recovered LIMIT 5;

-- Permanent deletion is explicit.
DROP TABLE scratch FORCE;`}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

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
              <li>With Serializable isolation by default, one order commits and the conflicting transaction retries.</li>
              <li>The database protects the inventory invariant instead of leaving oversold stock to asynchronous repair.</li>
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
        <BranchingWorkflow />
        <RecoveryWorkflow />
        <AdvantageComparison />
      </main>
    </Layout>
  );
}
