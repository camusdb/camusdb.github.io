import {useEffect, useRef, useState} from 'react';
import Link from '@docusaurus/Link';
import clsx from 'clsx';
import CamusPlayground, {
  defaultSeedScript,
  defaultExamples,
  HighlightedSql,
  SqlLineNumbers,
  ResultCard,
  syncEditorScroll,
} from '../CamusPlayground';
import {loadEngine} from '../CamusPlayground/runtime';
import editorStyles from '../CamusPlayground/styles.module.css';
import styles from './styles.module.css';

const emptyNodes = [0, 1, 2].map((index) => ({
  index,
  running: false,
  leads: [],
  blockedTo: [],
}));
const initialQuery =
  'SELECT title, author, year\nFROM books\nWHERE year < 1970\nORDER BY year;';
const label = (index) => `Node ${String(index + 1).padStart(2, '0')}`;
const partitionName = (index) =>
  index === 0 ? 'Metadata' : `Data${index > 1 ? ` ${index}` : ''}`;
const claims = (status, partition) =>
  status?.nodes.filter((n) => n.running && n.leads.includes(partition)) ?? [];
// A survivor loses its link to the isolated node, but retains the other survivor.
const cut = (node, nodes) =>
  nodes
    .filter((other) => other.index !== node.index)
    .every(
      (other) =>
        node.blockedTo.includes(other.index) ||
        other.blockedTo.includes(node.index),
    );
const available = (node, nodes) => node.running && !cut(node, nodes);

function Icon({name, ...props}) {
  const paths = {
    server: (
      <>
        <rect x="4" y="3" width="16" height="7" rx="2" />
        <rect x="4" y="14" width="16" height="7" rx="2" />
        <path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8Z" />,
    reset: (
      <>
        <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    crown: (
      <>
        <path d="m3 6 4 4 5-7 5 7 4-4-2 12H5ZM6 21h12" />
      </>
    ),
    terminal: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="3" />
        <path d="m6 8 4 4-4 4m7 0h5" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export default function ClusterPlayground() {
  const [mode, setMode] = useState('cluster');
  const [engine, setEngine] = useState(null);
  const [cluster, setCluster] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Ready when you are. Start your cluster to explore.',
  );
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  const [sql, setSql] = useState(initialQuery);
  const [database, setDatabase] = useState('playground');
  const [databases, setDatabases] = useState(['playground']);
  const [results, setResults] = useState([]);
  const [request, setRequest] = useState(null);
  const [events, setEvents] = useState([]);
  const [inspected, setInspected] = useState(null);
  const highlightRef = useRef(null);
  const lineNumbersRef = useRef(null);
  const lock = useRef(false);
  const pendingPoll = useRef(null);
  const mounted = useRef(true);
  const apiRef = useRef(null);
  const statusRef = useRef(null);
  const sequence = useRef(0);
  const nodes = cluster?.nodes ?? emptyNodes;
  const active = nodes.filter((n) => available(n, nodes));
  const disconnected = nodes.some((n) => n.blockedTo.length > 0);
  const resolved =
    cluster &&
    Array.from(
      {length: cluster.partitionCount},
      (_, p) =>
        claims(cluster, p).length === 1 &&
        available(claims(cluster, p)[0], nodes),
    ).every(Boolean);
  const health = !cluster
    ? 'Offline'
    : active.length < 2
      ? 'No connected majority'
      : !resolved
        ? 'Election / reconciling'
        : active.length === 3
          ? 'Cluster stable'
          : 'Cluster degraded';
  const canRun =
    !!cluster &&
    !busy &&
    available(nodes[selected], nodes) &&
    active.length >= 2;

  function log(text, kind = 'info') {
    if (!mounted.current) return;
    setEvents((old) =>
      [
        {
          id: ++sequence.current,
          text,
          kind,
          time: new Date().toLocaleTimeString([], {hour12: false}),
        },
        ...old,
      ].slice(0, 40),
    );
  }
  function acceptStatus(next) {
    if (!mounted.current) return;
    const previous = statusRef.current;
    if (previous) {
      for (let p = 0; p < next.partitionCount; p++) {
        const before = claims(previous, p)
          .map((n) => n.index)
          .join(',');
        const after = claims(next, p)
          .map((n) => n.index)
          .join(',');
        if (before !== after) {
          const leaders = claims(next, p);
          log(
            leaders.length === 1
              ? `${partitionName(p)} leader → ${label(leaders[0].index)}`
              : leaders.length
                ? `${partitionName(p)}: conflicting leader claims`
                : `${partitionName(p)}: electing a leader`,
            'election',
          );
        }
      }
    }
    statusRef.current = next;
    setCluster(next);
    setSelected((current) =>
      available(next.nodes[current], next.nodes)
        ? current
        : (next.nodes.find((n) => available(n, next.nodes))?.index ?? current),
    );
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      apiRef.current?.StopClusterAsync().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!engine || !cluster || mode !== 'cluster') return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (lock.current || pendingPoll.current) return;
      pendingPoll.current = (async () => {
        try {
          const next = JSON.parse(await engine.ClusterStatusAsync());
          if (!cancelled) acceptStatus(next);
        } catch (err) {
          if (!cancelled) setError(`Status refresh failed: ${err.message}`);
        }
      })();
      await pendingPoll.current;
      pendingPoll.current = null;
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [engine, !!cluster, mode]);

  async function action(text, work) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage(text);
    try {
      await pendingPoll.current;
      await work();
      if (mounted.current)
        setMessage(
          'Cluster ready. Select a node, run SQL, or introduce a fault.',
        );
    } catch (err) {
      if (mounted.current) {
        setError(err.message);
        setMessage('Action failed. Review the error and try again.');
        log(err.message, 'error');
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function refreshDatabases(
    api,
    target,
    preferred = database,
    detectNew = false,
  ) {
    const [outcome] = JSON.parse(
      await api.ExecuteOnNodeAsync(target, 'SHOW DATABASES;', null),
    );
    if (!outcome?.ok) return;
    const names = outcome.rows.map((row) => row[0]);
    setDatabases(names);
    setDatabase(
      (detectNew && names.find((name) => !databases.includes(name))) ||
        (names.includes(preferred) ? preferred : names[0]) ||
        'playground',
    );
  }
  function start() {
    action(
      cluster
        ? 'Restarting the cluster and resetting sample data…'
        : 'Downloading WebAssembly and starting three nodes…',
      async () => {
        const api =
          engine ??
          (await loadEngine((loaded, total) => {
            if (mounted.current)
              setMessage(
                `Downloading WebAssembly · ${loaded} / ${total} resources`,
              );
          }));
        apiRef.current = api;
        if (!mounted.current) return;
        setEngine(api);
        setMessage('Starting three nodes and electing partition leaders…');
        // Clear the previous session before a reset; a failed start must not leave stale nodes visible.
        statusRef.current = null;
        setCluster(null);
        setResults([]);
        setRequest(null);
        const next = JSON.parse(await api.StartClusterAsync(3));
        if (!mounted.current) {
          await api.StopClusterAsync();
          return;
        }
        acceptStatus(next);
        setMessage('Loading the sample library…');
        const outcomes = JSON.parse(
          await api.ExecuteOnNodeAsync(0, defaultSeedScript, 'playground'),
        );
        const failed = outcomes.find((o) => !o.ok);
        if (failed)
          throw new Error(`Sample data: ${failed.code}: ${failed.message}`);
        setSelected(0);
        await refreshDatabases(api, 0, 'playground');
        acceptStatus(JSON.parse(await api.ClusterStatusAsync()));
        log('Three nodes online · sample library loaded', 'success');
      },
    );
  }
  function changeMode(next) {
    if (busy || lock.current || mode === next) return;
    action('Switching playground…', async () => {
      if (engine) await engine.StopClusterAsync();
      statusRef.current = null;
      setCluster(null);
      setRequest(null);
      setResults([]);
      setMode(next);
    });
  }
  function fault(node, kind) {
    action(
      `${kind === 'stop' ? 'Stopping' : kind === 'start' ? 'Restarting' : 'Isolating'} ${label(node.index)}…`,
      async () => {
        let next;
        if (kind === 'isolate') {
          for (const other of nodes.filter((n) => n.index !== node.index)) {
            await engine.BlockLinkAsync(node.index, other.index);
            next = JSON.parse(
              await engine.BlockLinkAsync(other.index, node.index),
            );
          }
        } else
          next = JSON.parse(
            await engine[kind === 'stop' ? 'StopNodeAsync' : 'StartNodeAsync'](
              node.index,
            ),
          );
        acceptStatus(next);
        log(
          `${label(node.index)} ${kind === 'stop' ? 'stopped · survivors elect new leaders' : kind === 'start' ? 'restarted · catching up from peers' : 'isolated · all links cut in both directions'}`,
          kind === 'start' ? 'success' : 'fault',
        );
      },
    );
  }
  function restore() {
    action('Restoring network links…', async () => {
      acceptStatus(JSON.parse(await engine.RestoreLinksAsync()));
      log('All network links restored', 'success');
    });
  }
  function run(nextSql = sql) {
    if (!canRun || !nextSql.trim()) return;
    const target = selected;
    const id = ++sequence.current;
    action(`Running SQL through ${label(target)}…`, async () => {
      setRequest({id, target, phase: 'running'});
      const started = performance.now();
      try {
        const outcomes = JSON.parse(
          await engine.ExecuteOnNodeAsync(target, nextSql.trim(), database),
        );
        const ms = performance.now() - started;
        const failed = outcomes.some((o) => !o.ok);
        setResults(outcomes);
        setRequest({
          id,
          target,
          phase: failed ? 'failed' : 'complete',
          ms,
          rows: outcomes.reduce((n, o) => n + (o.rows?.length ?? 0), 0),
        });
        log(
          `${label(target)} ${failed ? 'returned a SQL error' : 'returned the result'} · ${Math.round(ms)} ms`,
          failed ? 'error' : 'query',
        );
        await refreshDatabases(engine, target, database, !failed);
        acceptStatus(JSON.parse(await engine.ClusterStatusAsync()));
      } catch (err) {
        setRequest({id, target, phase: 'failed'});
        throw err;
      }
    });
  }
  const leader = claims(cluster, 0).length === 1 ? claims(cluster, 0)[0] : null;
  const inspectedNode = inspected === null ? null : nodes[inspected];

  return (
    <div className={styles.lab}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>
            <span /> CAMUSDB / INTERACTIVE LAB
          </div>
          <h1>
            A distributed database.
            <br />
            <em>In your browser.</em>
          </h1>
          <p>
            Three real nodes. Live elections. SQL that keeps moving.
            <br />
            Pull a node offline and watch the cluster find its way.
          </p>
        </div>
        <div className={styles.heroAside}>
          <span className={styles.wasmBadge}>
            WASM <span>POWERED</span>
          </span>
          <span>
            Real engine. In-memory data.
            <br />
            Everything stays in this tab.
          </span>
        </div>
      </header>
      <div className={styles.modeBar}>
        <div className={styles.modeSwitch} aria-label="Playground mode">
          <button
            aria-pressed={mode === 'single'}
            disabled={busy}
            onClick={() => changeMode('single')}
          >
            <Icon name="terminal" /> Single node
          </button>
          <button
            aria-pressed={mode === 'cluster'}
            disabled={busy}
            onClick={() => changeMode('cluster')}
          >
            <Icon name="server" /> 3-node cluster
          </button>
        </div>
        <Link to="/docs/browser-playground">
          How it works <Icon name="arrow" />
        </Link>
      </div>
      {mode === 'single' ? (
        <div className={styles.single} data-theme="dark">
          <CamusPlayground className={editorStyles.console} />
        </div>
      ) : (
        <>
          <section className={styles.topology} aria-label="Cluster topology">
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.sectionIndex}>01</span>
                <h2>Cluster overview</h2>
                <span
                  className={clsx(
                    styles.health,
                    cluster && resolved && active.length === 3
                      ? styles.green
                      : cluster && styles.amber,
                  )}
                >
                  <i />
                  {health}
                </span>
              </div>
              <div className={styles.toolbar}>
                {cluster && (
                  <button disabled={busy} onClick={start}>
                    <Icon name="reset" /> Reset cluster
                  </button>
                )}
                <span className={styles.live}>
                  {cluster ? 'LIVE · 1s refresh' : 'AWAITING START'}
                </span>
              </div>
            </div>
            <div className={styles.topologyBody}>
              <div className={styles.network}>
                <div className={styles.networkMeta}>
                  <span>
                    LOCAL CLUSTER <b> / 3 NODES</b>
                  </span>
                  <span>
                    {cluster
                      ? `${active.length}/3 connected`
                      : 'In-memory transport'}
                  </span>
                </div>
                <div className={styles.client}>
                  <Icon name="terminal" />
                  <span>SQL client</span>
                  <span className={styles.clientTarget}>
                    {cluster ? `→ ${label(selected)}` : 'Your browser'}
                  </span>
                </div>
                <div
                  className={clsx(
                    styles.wires,
                    request?.phase === 'running' && styles.queryRunning,
                  )}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 900 90" preserveAspectRatio="none">
                    <path
                      d="M450 0V25Q450 36 435 36H165Q150 36 150 50V90"
                      className={clsx(
                        cluster &&
                          available(nodes[0], nodes) &&
                          styles.connected,
                        selected === 0 && styles.route,
                      )}
                    />
                    <path
                      d="M450 0V90"
                      className={clsx(
                        cluster &&
                          available(nodes[1], nodes) &&
                          styles.connected,
                        selected === 1 && styles.route,
                      )}
                    />
                    <path
                      d="M450 0V25Q450 36 465 36H735Q750 36 750 50V90"
                      className={clsx(
                        cluster &&
                          available(nodes[2], nodes) &&
                          styles.connected,
                        selected === 2 && styles.route,
                      )}
                    />
                  </svg>
                </div>
                <div className={styles.nodes}>
                  {nodes.map((node) => {
                    const isolated = cut(node, nodes);
                    const state = !cluster
                      ? 'Standby'
                      : !node.running
                        ? 'Stopped'
                        : isolated
                          ? 'Isolated'
                          : 'Online';
                    const nodeLeads = node.running ? node.leads : [];
                    const serving = request?.target === node.index;
                    return (
                      <article
                        key={node.index}
                        className={clsx(
                          styles.node,
                          cluster && !node.running && styles.stopped,
                          isolated && styles.isolated,
                          cluster && selected === node.index && styles.selected,
                          serving &&
                            request.phase === 'running' &&
                            styles.serving,
                        )}
                      >
                        <div className={styles.nodeTop}>
                          <div className={styles.serverIcon}>
                            <Icon name="server" width="27" height="27" />
                          </div>
                          <span className={styles.nodeState}>
                            <i />
                            {state}
                          </span>
                        </div>
                        <button
                          className={styles.nodeName}
                          aria-label={`Inspect ${label(node.index)}`}
                          onClick={() =>
                            setInspected(
                              inspected === node.index ? null : node.index,
                            )
                          }
                        >
                          {label(node.index)}
                          <span>↗</span>
                        </button>
                        <span className={styles.endpoint}>
                          camus://local/{node.index + 1}
                        </span>
                        <div className={styles.roles}>
                          {!cluster ? (
                            <span className={styles.follower}>
                              Waiting to join
                            </span>
                          ) : !node.running ? (
                            <span className={styles.follower}>Unavailable</span>
                          ) : nodeLeads.length ? (
                            nodeLeads.map((p) => (
                              <span key={p} className={styles.leader}>
                                <Icon name="crown" width="12" height="12" />
                                {partitionName(p)} leader
                                {claims(cluster, p).length > 1 || isolated
                                  ? ' · claim'
                                  : ''}
                              </span>
                            ))
                          ) : (
                            <span className={styles.follower}>Follower</span>
                          )}
                        </div>
                        <div className={styles.served}>
                          {serving ? (
                            <>
                              <span
                                className={
                                  request.phase === 'failed'
                                    ? styles.red
                                    : styles.cyan
                                }
                              >
                                ●
                              </span>{' '}
                              {request.phase === 'running'
                                ? 'Serving request…'
                                : request.phase === 'failed'
                                  ? 'Last request failed'
                                  : 'Returned last result'}
                            </>
                          ) : cluster && selected === node.index ? (
                            <>
                              <span className={styles.cyan}>◎</span> Query
                              target
                            </>
                          ) : (
                            <span>
                              {isolated
                                ? 'Peer links disconnected'
                                : node.running
                                  ? 'Ready for requests'
                                  : '—'}
                            </span>
                          )}
                        </div>
                        <button
                          className={styles.routeButton}
                          disabled={!cluster || busy || !available(node, nodes)}
                          aria-pressed={selected === node.index && !!cluster}
                          onClick={() => setSelected(node.index)}
                        >
                          {cluster && selected === node.index
                            ? '◎ Selected target'
                            : 'Route queries here'}
                          <Icon name="arrow" width="14" height="14" />
                        </button>
                        <div className={styles.nodeActions}>
                          {node.running ? (
                            <>
                              <button
                                disabled={
                                  busy || active.length < 3 || disconnected
                                }
                                onClick={() => fault(node, 'stop')}
                                title="Crash this node. Two connected nodes must survive."
                              >
                                Stop node
                              </button>
                              <button
                                disabled={
                                  busy || active.length < 3 || disconnected
                                }
                                onClick={() => fault(node, 'isolate')}
                                title="Cut both directions of every link to this node."
                              >
                                Isolate
                              </button>
                            </>
                          ) : (
                            <button
                              disabled={!cluster || busy}
                              onClick={() => fault(node, 'start')}
                            >
                              Restart node
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className={styles.replication}>
                  <span
                    className={
                      cluster && !disconnected && active.length === 3
                        ? styles.replicationLive
                        : ''
                    }
                  />
                  <span>Raft peer links</span>
                  <span
                    className={
                      cluster && !disconnected && active.length === 3
                        ? styles.replicationLive
                        : ''
                    }
                  />
                </div>
                <div className={styles.legend}>
                  <span>
                    <i className={styles.goldDot} /> Partition leader
                  </span>
                  <span>
                    <i className={styles.cyanDot} /> Query route
                  </span>
                  <span>
                    <i className={styles.redDot} /> Stopped / isolated
                  </span>
                </div>
              </div>
              <aside className={styles.experiment}>                
                <h3>
                  {!cluster
                    ? 'Your own tiny cluster.'
                    : 'Put resilience to the test.'}
                </h3>
                <p>
                  {!cluster
                    ? 'Start three CamusDB engines and a sample library. No installation. No server.'
                    : 'Stop the metadata leader. Watch a new leader emerge, then query through a survivor.'}
                </p>
                {!cluster ? (
                  <button
                    className={styles.primary}
                    disabled={busy}
                    onClick={start}
                  >
                    <Icon name="play" />
                    {busy ? 'Starting cluster…' : 'Start 3-node cluster'}
                  </button>
                ) : (
                  <>
                    <button
                      className={styles.faultButton}
                      disabled={
                        busy || !leader || active.length < 3 || disconnected
                      }
                      onClick={() => fault(leader, 'stop')}
                    >
                      <Icon name="bolt" /> Stop metadata leader
                    </button>
                    {disconnected && (
                      <button
                        className={styles.primary}
                        disabled={busy}
                        onClick={restore}
                      >
                        <Icon name="reset" /> Restore all links
                      </button>
                    )}
                  </>
                )}
                <ol className={styles.steps}>
                  <li>
                    <b>01</b>
                    <span>
                      Choose your query target
                      <small>Any connected node can receive SQL.</small>
                    </span>
                  </li>
                  <li>
                    <b>02</b>
                    <span>
                      Introduce a failure
                      <small>Stop a node or cut its network links.</small>
                    </span>
                  </li>
                  <li>
                    <b>03</b>
                    <span>
                      Watch the recovery
                      <small>Restart it and query the data again.</small>
                    </span>
                  </li>
                </ol>
                <div className={styles.quorum}>
                  <span>MAJORITY REQUIRED</span>
                  <strong>
                    2 <small>of</small> 3
                  </strong>
                  <p>
                    One failure is enough to explore failover. Restore it before
                    adding another.
                  </p>
                </div>
              </aside>
            </div>
            {inspectedNode && (
              <div className={styles.inspector}>
                <strong>{label(inspectedNode.index)}</strong>
                <span>{cluster ? inspectedNode.endpoint : 'Not started'}</span>
                <span>
                  {inspectedNode.running
                    ? `Reports leadership for: ${inspectedNode.leads.map((p) => `P${p}`).join(', ') || 'none'}`
                    : 'Engine is not running'}
                </span>
                <span>
                  Blocked outgoing links:{' '}
                  {inspectedNode.blockedTo.map(label).join(', ') || 'none'}
                </span>
                <button
                  onClick={() => setInspected(null)}
                  aria-label="Close node details"
                >
                  ×
                </button>
              </div>
            )}
            <div className={styles.partitionBar}>
              {Array.from({length: cluster?.partitionCount ?? 2}, (_, p) => (
                <div key={p}>
                  <span>
                    P{p} / {partitionName(p)}
                  </span>
                  <strong>
                    {!cluster
                      ? 'Awaiting start'
                      : claims(cluster, p).length === 0
                        ? 'Electing…'
                        : claims(cluster, p).length > 1
                          ? 'Conflicting claims'
                          : `${label(claims(cluster, p)[0].index)}${cut(claims(cluster, p)[0], nodes) ? ' · isolated claim' : ''}`}
                  </strong>
                </div>
              ))}
              <p>
                Leadership is per partition. Isolated nodes may report stale
                claims.
              </p>
            </div>
          </section>
          <div className={styles.statusLine} role="status">
            <span className={busy ? styles.spinner : styles.statusLight} />
            {message}
          </div>
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          <section
            className={clsx(styles.workspace, editorStyles.playground)}
            data-theme="dark"
            aria-label="SQL workspace"
          >
            <div className={styles.queryPane}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.sectionIndex}>02</span>
                  <h2>SQL workspace</h2>
                </div>
                <label className={styles.database}>
                  Database{' '}
                  <select
                    aria-label="Cluster database"
                    value={database}
                    disabled={!cluster || busy}
                    onChange={(event) => setDatabase(event.target.value)}
                  >
                    {databases.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={styles.examples}>
                {[
                  defaultExamples[2],
                  defaultExamples[3],
                  defaultExamples[6],
                  defaultExamples[8],
                ].map((example) => (
                  <button
                    key={example.label}
                    disabled={busy}
                    onClick={() => setSql(example.sql)}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
              <div className={clsx(editorStyles.editorPane, styles.editor)}>
                <div className={editorStyles.editorWrap}>
                  <SqlLineNumbers code={sql} lineNumbersRef={lineNumbersRef} />
                  <HighlightedSql code={sql} highlightRef={highlightRef} />
                  <textarea
                    aria-label="Cluster SQL"
                    value={sql}
                    wrap="off"
                    spellCheck="false"
                    autoCapitalize="off"
                    autoComplete="off"
                    onChange={(e) => setSql(e.target.value)}
                    onScroll={(e) => {
                      syncEditorScroll(e.currentTarget, highlightRef, lineNumbersRef);
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        run();
                      }
                    }}
                  />
                </div>
              </div>
              <div className={styles.queryActions}>
                <span>
                  <i className={styles.cyanDot} />
                  {cluster
                    ? `via ${label(selected)}`
                    : 'Start the cluster to run SQL'}
                </span>
                <button
                  className={styles.primary}
                  disabled={!canRun || !sql.trim()}
                  onClick={() => run()}
                >
                  <Icon name="play" />
                  Run query <kbd>⌘ / Ctrl ↵</kbd>
                </button>
              </div>
            </div>
            <div className={styles.outputPane}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Query results</h2>
                  {request && (
                    <span className={styles.resultBadge}>
                      {request.phase === 'running'
                        ? 'Running'
                        : request.phase === 'failed'
                          ? 'Failed'
                          : `${request.rows} rows`}
                    </span>
                  )}
                </div>
                {request?.ms != null && (
                  <span className={styles.timing}>
                    {Math.round(request.ms)} ms
                  </span>
                )}
              </div>
              {request && (
                <div key={request.id} className={styles.requestRoute}>
                  <span>SQL client</span>
                  <Icon name="arrow" />
                  <strong>{label(request.target)}</strong>
                  <Icon name="arrow" />
                  <span>
                    {request.phase === 'running'
                      ? 'Executing…'
                      : request.phase === 'failed'
                        ? 'Error'
                        : 'Result returned'}
                  </span>
                </div>
              )}
              <div className={styles.results}>
                {results.length ? (
                  results.map((outcome, index) => (
                    <ResultCard
                      outcome={outcome}
                      key={`${request?.id}-${index}`}
                    />
                  ))
                ) : (
                  <div className={styles.empty}>
                    <Icon name="terminal" width="34" height="34" />
                    <h3>A query is worth a thousand diagrams.</h3>
                    <p>
                      Run the sample SQL and see which node returns your data.
                    </p>
                    <span>SELECT → EXECUTE → EXPLORE</span>
                  </div>
                )}
              </div>
              <p className={styles.telemetryNote}>
                The route identifies the request coordinator. Internal data
                reads and replication are not traced by this engine.
              </p>
            </div>
          </section>
          <section className={styles.timeline} aria-label="Cluster events">
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.sectionIndex}>03</span>
                <h2>Live event stream</h2>
                <span className={styles.eventCount}>{events.length}</span>
              </div>
              <button disabled={!events.length} onClick={() => setEvents([])}>
                Clear events
              </button>
            </div>
            <div className={styles.eventList} role="log" aria-live="polite">
              {events.length ? (
                events.map((event) => (
                  <div
                    key={event.id}
                    className={styles.event}
                    data-kind={event.kind}
                  >
                    <time>{event.time}</time>
                    <span className={styles.eventKind}>{event.kind}</span>
                    <span>{event.text}</span>
                  </div>
                ))
              ) : (
                <p className={styles.noEvents}>
                  Your cluster story starts here. Elections, failures, and query
                  results appear as they happen.
                </p>
              )}
            </div>
          </section>
          <footer className={styles.footer}>
            <span>
              <i className={styles.greenDot} /> Real CamusDB + Raft ·
              WebAssembly · No server required
            </span>
            <span>
              In-memory data resets on reload. Connection motion illustrates
              topology.
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
