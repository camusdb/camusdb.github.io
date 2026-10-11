import Layout from '@theme/Layout';
import ClusterPlayground from '@site/src/components/ClusterPlayground';
import styles from './playground.module.css';

export default function PlaygroundPage() {
  return (
    <Layout
      title="Playground"
      description="Run a real three-node CamusDB cluster in your browser. Explore SQL, leader elections, failures, and recovery with WebAssembly."
    >
      <main className={styles.page}>
        <ClusterPlayground />
      </main>
    </Layout>
  );
}
