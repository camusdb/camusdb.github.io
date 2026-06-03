import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';
import styles from './index.module.css';

function HomepageHeader() {
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <p className={styles.eyebrow}>Distributed NewSQL database</p>
        <Heading as="h1" className={styles.title}>
          CamusDB
        </Heading>
        <p className={styles.subtitle}>
          SQL ergonomics with distributed storage: multi-active nodes,
          Raft-backed replication, serializable transactions, and partitioned
          cluster execution.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/intro">
            Start the tutorial
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/why-camusdb">
            Why CamusDB?
          </Link>
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
