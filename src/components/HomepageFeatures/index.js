import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'SQL-first NewSQL',
    description:
      'Create schemas, index tables, query rows, aggregate data, and mutate records through familiar SQL.',
  },
  {
    title: 'Transactional writes',
    description:
      'Group changes with explicit transactions and keep writes consistent with ACID semantics.',
  },
  {
    title: 'Distributed cluster mode',
    description:
      'Run multiple nodes with partition routing, automatic leader election, and replicated storage.',
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
