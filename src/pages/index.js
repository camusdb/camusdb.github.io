import clsx from 'clsx';
import {useEffect, useRef, useState} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl, {useBaseUrlUtils} from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import CodeBlock from '@theme/CodeBlock';
import Heading from '@theme/Heading';
import ThemedImage from '@theme/ThemedImage';
import PyramidEntrance from '../components/PyramidEntrance';
import styles from './index.module.css';

// The hero shows one message at a time. The first message is the one in the
// static HTML, so it is the headline that search engines read.
const heroMessages = [
  {
    id: 'scale',
    title: 'Scale with your traffic, without giving up transactions',
    subtitle:
      'CamusDB partitions data, replicates every write by consensus, and runs Serializable transactions by default, while your application uses familiar SQL',
    link: '/docs/why-camusdb',
  },
  {
    id: 'availability',
    title: 'Keep your database online when a server fails',
    subtitle:
      'A CamusDB cluster has no primary server to lose: any node serves requests, and when one node fails, the others continue to serve reads and writes',
    link: '/docs/cluster',
  },
  {
    id: 'branching',
    title: 'Branch your database to test risky changes',
    subtitle:
      'One SQL statement creates an isolated branch of a database without copying rows, so you can rehearse a migration on real data while the source stays unchanged',
    link: '/docs/database-branching',
  },
  {
    id: 'recovery',
    title: 'Undo a wrong DROP TABLE without a backup restore',
    subtitle:
      'A dropped table or database stays recoverable for a retention window, seven days by default, and time-travel queries show your data as it was minutes ago',
    link: '/docs/recover-dropped-objects',
  },
  {
    id: 'extensions',
    title: 'Run your C# business logic inside the database',
    subtitle:
      'Write functions, triggers, and procedures in modern C# and call them from SQL; a trigger runs in the same transaction as the write that fires it, so every writer follows the same rule',
    link: '/docs/csharp-extensions',
  },
];

// Time that each hero message stays on screen.
const HERO_ROTATION_MS = 8000;

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
  {
    title: 'In-process C# extensions',
    detail: 'Define C# functions and triggers inline, or load reviewed .NET assemblies.',
  },
];

const outcomes = [
  {
    label: 'Scale',
    title: 'Spend less time on sharding logic',
    detail:
      'CamusDB partitions data and routes each write to the leader of the partition that owns its key range.',
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
  {
    label: 'Extensibility',
    title: 'Run business logic next to the data',
    detail:
      'Define C# functions and triggers directly in SQL, or deploy reviewed assemblies for functions, triggers, and procedures. Keep shared business rules close to the data.',
    link: '/docs/csharp-extensions',
    linkLabel: 'See C# extensions',
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
    id: 'extensions',
    label: 'C# assemblies',
    title: 'Call an external C# assembly from SQL',
    detail:
      'Deploy a reviewed .NET assembly to add SQL functions, row triggers, and transactional procedures. Functions and triggers can also be defined inline in SQL, without deploying a DLL.',
    link: '/docs/csharp-extensions',
    linkLabel: 'Read the extensions guide',
    code: `-- slugify() is a C# method marked [CamusFunction].
SELECT slugify(title) FROM posts;

-- Fire a C# class for every changed row,
-- inside the same transaction.
CREATE TRIGGER audit ON orders
AFTER INSERT, UPDATE, DELETE
EXTERNAL NAME 'MyCompany.Ext.AuditTrigger';

-- Run a multi-statement C# procedure atomically.
CALL transfer('alice', 'bob', 30);`,
  },
  {
    id: 'inline-trigger',
    label: 'Inline trigger',
    title: 'Normalize every product write',
    detail:
      'Define a C# trigger body directly in SQL. This BEFORE trigger derives a product slug on every insert or update, so every client gets the same normalization without an extension assembly.',
    link: '/docs/csharp-extensions#inline-triggers',
    linkLabel: 'Read the inline trigger guide',
    code: `-- Set inline_triggers_enabled: true and restart the server.
CREATE TABLE products (
  sku STRING PRIMARY KEY,
  title STRING NOT NULL,
  slug STRING
);

CREATE TRIGGER product_slug ON products
BEFORE INSERT, UPDATE LANGUAGE csharp AS $$
    if (NEW!.title is { } title)
        NEW.slug = title.Trim().ToLowerInvariant().Replace(' ', '-');
$$;

INSERT INTO products (sku, title) VALUES ('book-1', 'New Book');
SELECT sku, slug FROM products; -- book-1, new-book`,
  },
  {
    id: 'optimizer',
    label: 'Query optimizer',
    title: 'Let the optimizer plan a complex query',
    detail:
      'The cost-based optimizer uses table statistics to pick the join order, the access path for each table, and the join algorithm. Prefix the query with EXPLAIN to see the plan.',
    link: '/docs/query-planning',
    linkLabel: 'Read the query-planning guide',
    code: `-- Join order, access paths, and join algorithms
-- come from statistics, not from the text order.
SELECT c.region,
       COUNT(*)      AS paid_orders,
       SUM(o.total)  AS revenue,
       AVG(li.items) AS avg_items
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN (
  SELECT order_id, COUNT(*) AS items
  FROM order_items
  GROUP BY order_id
) li ON li.order_id = o.id
WHERE o.status = "paid"
  -- Eligible for an anti-join rewrite.
  AND c.id NOT IN (SELECT customer_id FROM fraud_flags)
  -- Eligible for an indexed seek per order.
  AND EXISTS (
    SELECT * FROM shipments s
    WHERE s.order_id = o.id AND s.delivered = true
  )
GROUP BY c.region
HAVING SUM(o.total) > 10000
ORDER BY revenue DESC
LIMIT 10;`,
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

// Captured by `npm run screenshots` (scripts/screenshots). The terminal shots have one theme only.
const screenshots = [
  {
    id: 'web-console',
    label: 'Web Console',
    title: 'Query from the browser',
    detail:
      'Browse schemas, run SQL, and inspect results in the Web Console, without a SQL client on each machine.',
    light: '/img/screenshots/webconsole-query-light.webp',
    dark: '/img/screenshots/webconsole-query-dark.webp',
    link: '/docs/web-console',
    linkLabel: 'Read the Web Console guide',
  },
  {
    id: 'query-plan',
    label: 'Query plans',
    title: 'Read a plan as a flow',
    detail:
      'Run EXPLAIN in the Web Console and see each operator as a diagram, from the source tables to the result.',
    light: '/img/screenshots/webconsole-plan-light.webp',
    dark: '/img/screenshots/webconsole-plan-dark.webp',
    link: '/docs/web-console#query-plan-flow',
    linkLabel: 'Read about plan flows',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    title: 'Check a node at a glance',
    detail:
      'Open the HTTP port of a node to see its health, load, engine metrics, and slow queries. The dashboard is read-only.',
    light: '/img/screenshots/dashboard-light.webp',
    dark: '/img/screenshots/dashboard-dark.webp',
    link: '/docs/operator-dashboard',
    linkLabel: 'Read the dashboard guide',
  },
  {
    id: 'cli',
    label: 'camus-cli',
    title: 'Work from the terminal',
    detail:
      'camus-cli runs SQL with syntax highlighting, autocompletion, and multiline statements.',
    light: '/img/screenshots/cli.webp',
    dark: '/img/screenshots/cli.webp',
    link: '/docs/camus-cli',
    linkLabel: 'Read the camus-cli guide',
  },
  {
    id: 'tui',
    label: 'Full-screen mode',
    title: 'Keep the catalog, editor, and results in view',
    detail:
      'camus-cli --tui shows the catalog, the SQL editor, and the results on one screen.',
    light: '/img/screenshots/tui.webp',
    dark: '/img/screenshots/tui.webp',
    link: '/docs/camus-cli#full-screen-mode',
    linkLabel: 'Read about full-screen mode',
  },
];

// A link between two nodes. One packet travels in each direction.
function DataBeam({className}) {
  return (
    <div className={clsx(styles.dataBeam, className)} aria-hidden="true">
      <span className={styles.beamLink} />
      <span className={styles.beamPacketOut} />
      <span className={styles.beamPacketBack} />
    </div>
  );
}

// The cluster animation in index.module.css stops the right node, then brings it back.
const pyramids = [
  {id: 'top', className: styles.pyramidTop},
  {id: 'left', className: styles.pyramidLeft},
  {id: 'right', className: styles.pyramidRight, canStop: true},
];

function PyramidNetwork({className}) {
  const pyramidUrl = useBaseUrl('/img/pyramid.png');
  const networkRef = useRef(null);
  const pyramidRefs = useRef([]);
  const [isAssembling, setIsAssembling] = useState(false);

  return (
    <div
      ref={networkRef}
      className={clsx(styles.pyramidNetwork, className, isAssembling && styles.pyramidAssembling)}
      role="group"
      aria-label="Three database nodes that replicate writes and continue when one node stops">
      <DataBeam className={styles.dataBeamLeft} />
      <DataBeam className={styles.dataBeamRight} />
      <DataBeam className={styles.dataBeamBase} />
      {pyramids.map((pyramid, index) => (
        <div className={clsx(styles.pyramidNode, pyramid.className)} key={pyramid.id} aria-hidden="true">
          <span className={styles.nodeRing} />
          <img
            ref={(node) => { pyramidRefs.current[index] = node; }}
            className={styles.pyramidImage}
            src={pyramidUrl}
            alt=""
          />
          {/* Copies of the artwork: a bright copy for a write, a dark copy for a stopped node. */}
          <img className={styles.nodeGlow} src={pyramidUrl} alt="" />
          {pyramid.canStop && <img className={styles.nodeDown} src={pyramidUrl} alt="" />}
          <span className={styles.nodeRequest} />
        </div>
      ))}
      <PyramidEntrance targetRefs={pyramidRefs} networkRef={networkRef} onActiveChange={setIsAssembling} />
    </div>
  );
}

function HomepageHeader() {
  const [activeIndex, setActiveIndex] = useState(0);
  // Rotation starts after hydration, so the timer and the progress bar start together.
  const [autoRotate, setAutoRotate] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const activeMessage = heroMessages[activeIndex];
  const isRotating = autoRotate && !isHovered && !hasFocus;

  useEffect(() => {
    // Visitors who ask for reduced motion change the message with the pager only.
    setAutoRotate(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!isRotating) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        setActiveIndex((index) => (index + 1) % heroMessages.length);
      }
    }, HERO_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [isRotating]);

  // A visitor who picks a message keeps it: the rotation stops.
  const selectMessage = (index) => {
    setActiveIndex(index);
    setAutoRotate(false);
  };

  return (
    <header className={styles.heroBanner}>
      <div className={styles.heroClouds} aria-hidden="true" />
      <div className="container">
        <div className={styles.heroLayout}>
          <div
            className={styles.heroCopy}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') {
                setIsHovered(true);
              }
            }}
            onPointerLeave={() => setIsHovered(false)}
            onFocus={() => setHasFocus(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setHasFocus(false);
              }
            }}>
            <div className={styles.eyebrowRow}>
              <span className={styles.eyebrow}>Open-source distributed SQL</span>
            </div>
            <div className={styles.heroMessages} aria-live={autoRotate ? 'off' : 'polite'}>
              {heroMessages.map((message, index) => {
                const isActive = index === activeIndex;
                // Only the visible title is the page heading.
                const Title = isActive ? 'h1' : 'p';
                return (
                  <div
                    className={clsx(styles.heroMessage, isActive && styles.heroMessageActive)}
                    key={message.id}
                    aria-hidden={!isActive}>
                    <Title className={styles.title}>{message.title}</Title>
                    <p className={styles.subtitle}>{message.subtitle}</p>
                  </div>
                );
              })}
            </div>
            <div
              className={styles.heroPager}
              role="group"
              aria-label="Hero messages"
              style={{'--hero-rotation': `${HERO_ROTATION_MS}ms`}}>
              {heroMessages.map((message, index) => {
                const isActive = index === activeIndex;
                return (
                  <button
                    className={clsx(
                      styles.heroPagerItem,
                      isActive && styles.heroPagerItemActive,
                      isActive && isRotating && styles.heroPagerItemRunning,
                    )}
                    key={message.id}
                    type="button"
                    aria-label={`Show message ${index + 1} of ${heroMessages.length}: ${message.title}`}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => selectMessage(index)}>
                    <span />
                  </button>
                );
              })}
            </div>
            <div className={styles.buttons}>
              <Link className={clsx('button button--lg', styles.playgroundAction)} to="/playground">
                Try in browser
              </Link>
              <Link className="button button--primary button--lg" to="/docs/intro">
                Install locally
              </Link>
              <Link className={styles.secondaryAction} to={activeMessage.link}>
                See how it works <span aria-hidden="true">→</span>
              </Link>
            </div>
            <p className={styles.statusNote}>
              <span className={styles.statusDot} aria-hidden="true" />
              <span className={styles.statusText}>
                <Link className={styles.statusLink} href="https://github.com/camusdb/camusdb-caraxes">Fault-tested with Caraxes</Link>
                {' '}and the Elle checker from Jepsen
              </span>
              <span aria-hidden="true">·</span>
              <span className={styles.statusText}>
                <Link className={styles.statusLink} to="/blog/camusdb-in-production-at-bacon-games">Used in production</Link>
                , some features are young
              </span>
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
          <p className={styles.sectionEyebrow}>Benefits</p>
          <Heading as="h2">Four practical reasons to explore CamusDB</Heading>
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
              <i className={styles.windowDots} aria-hidden="true" />
              <strong>{activeExample.title}</strong>
              <span>{activeExample.label}</span>
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

function ScreenshotGallery() {
  const [activeShotId, setActiveShotId] = useState(screenshots[0].id);
  const {withBaseUrl} = useBaseUrlUtils();

  return (
    <section className={styles.gallerySection}>
      <div className="container">
        <div className={styles.sectionIntro}>
          <p className={styles.sectionEyebrow}>See the tools</p>
          <Heading as="h2">Query and operate from the browser or the terminal</Heading>
        </div>
        <div className={styles.galleryTabs} role="tablist" aria-label="Screenshots">
          {screenshots.map((shot) => {
            const isActive = shot.id === activeShotId;
            return (
              <button
                className={clsx(styles.exampleTab, isActive && styles.exampleTabActive)}
                id={`shot-tab-${shot.id}`}
                key={shot.id}
                type="button"
                role="tab"
                aria-controls={`shot-panel-${shot.id}`}
                aria-selected={isActive}
                onClick={() => setActiveShotId(shot.id)}>
                {shot.label}
              </button>
            );
          })}
        </div>
        {screenshots.map((shot, index) => (
          <figure
            className={styles.galleryPanel}
            id={`shot-panel-${shot.id}`}
            key={shot.id}
            role="tabpanel"
            aria-labelledby={`shot-tab-${shot.id}`}
            hidden={shot.id !== activeShotId}>
            <ThemedImage
              className={styles.galleryImage}
              alt={`${shot.label}: ${shot.title}`}
              loading={index === 0 ? 'eager' : 'lazy'}
              sources={{light: withBaseUrl(shot.light), dark: withBaseUrl(shot.dark)}}
            />
            <figcaption className={styles.galleryCaption}>
              <div>
                <strong>{shot.title}</strong>
                <span>{shot.detail}</span>
              </div>
              <Link to={shot.link}>
                {shot.linkLabel} <span aria-hidden="true">→</span>
              </Link>
            </figcaption>
          </figure>
        ))}
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
          <p>
            Run the server locally from NuGet or Docker, or deploy a cluster with
            the <Link to="/docs/kubernetes-operator">Kubernetes Operator</Link>. Then follow the
            tutorial and review the current scope.
          </p>
        </div>
        <div className={styles.finalActions}>
          <Link className={clsx('button button--lg', styles.playgroundAction)} to="/playground">
            Open the playground
          </Link>
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
      description="Explore CamusDB, an open-source distributed SQL database with partitioned writes, Serializable transactions, database branching, recoverable drops, and C# functions and triggers defined inline or loaded from assemblies.">
      <HomepageHeader />
      <main>
        <OutcomeSection />
        <FamiliarSqlSection />
        <ScreenshotGallery />
        <FinalCallToAction />
      </main>
    </Layout>
  );
}
