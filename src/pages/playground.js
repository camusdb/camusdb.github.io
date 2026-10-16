import Layout from '@theme/Layout';
import DatacenterPlayground from '@site/src/components/DatacenterPlayground';
import styles from './playground.module.css';

export default function PlaygroundPage() {
  return (
    <Layout
      noFooter
      title="Playground"
      description="Explore an interactive CamusDB data center: traffic-driven scaling, node internals, and failure recovery. Run real SQL with WebAssembly."
    >
      <main className={styles.page}>
        <DatacenterPlayground />
      </main>
    </Layout>
  );
}
