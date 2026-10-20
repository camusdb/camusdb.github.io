import MDXComponents from '@theme-original/MDXComponents';
import {ArchDiagram, ReplicaRing} from '@site/src/components/Diagrams';

// Components available in every .md/.mdx file without an import.
export default {
  ...MDXComponents,
  ArchDiagram,
  ReplicaRing,
};
