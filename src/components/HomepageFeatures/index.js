import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'SQL without manual sharding',
    description:
      'Define tables and indexes, then query with joins, subqueries, derived tables, grouping, ordering, and pagination.',
  },
  {
    title: 'Serializable by default',
    description:
      'Protect application invariants with serializable transactions and two-phase commit for cross-partition writes.',
  },
  {
    title: 'Multi-active cluster',
    description:
      'Send traffic to multiple nodes while Raft-backed partitions elect leaders and replicate committed writes.',
  },
];

function Feature({title, description}) {
  return (
    <div className="col col--4">
      <div className={styles.feature}>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props) => (
            <Feature key={props.title} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
