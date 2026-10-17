import {useEffect, useRef, useState} from 'react';
import {defaultExamples, HighlightedSql, ResultCard} from '../CamusPlayground';
import {MAX, MIN, nodeName, recommendation} from './model';
import useCluster from './useCluster';
import styles from './styles.module.css';

export default function DatacenterPlayground() {
  const lab = useCluster(true);
  const highlightRef = useRef(null);
  const editorRef = useRef(null);
  useEffect(() => {
    if (highlightRef.current && editorRef.current) {
      highlightRef.current.style.transform = `translate(${-editorRef.current.scrollLeft}px, ${-editorRef.current.scrollTop}px)`;
    }
  }, [lab.sql]);
  const starting = !['ready', 'error'].includes(lab.startup);
  const {cluster, busy, auto, setAuto, traffic, setTraffic} = lab;
  const [selected, setSelected] = useState(0);
  const [rotation, setRotation] = useState(-30);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(null);
  const [layer, setLayer] = useState('traffic');
  const nodes = cluster?.nodes ?? [];
  const count = nodes.length;
  const failed = nodes.filter((n) => !n.running).map((n) => n.index);
  const inspect = Math.max(0, Math.min(selected, count - 1));
  const node = nodes[inspect];
  const partitions = (cluster?.partitions ?? [])
    .filter((p) => p.state !== 'Removed')
    .map((p) => {
      const leaders = nodes.filter((n) => n.running && n.leads.includes(p.id));
      return {
        ...p,
        replicaDetails: p.replicas,
        replicas: p.replicas.map((r) => r.index),
        leader: leaders.length === 1 ? leaders[0].index : null,
      };
    });
  const unavailable = partitions.filter((p) => p.leader === null).length;
  const online = nodes.filter((n) => n.running && n.role === 'Voter').length;
  const hosted = partitions.filter((p) => node?.hosts.includes(p.id));
  const desired = auto
    ? recommendation(count, traffic)
    : !cluster && busy
      ? MIN
      : count;
  const slots = Array.from({length: MAX}, (_, id) => ({
    id,
    x: 90 + (id % 3) * 150,
    // Fill the front row first; capacity expands toward the back.
    y: 390 - Math.floor(id / 3) * 150,
  }));
  const status = !cluster
    ? busy
      ? 'Starting engines…'
      : 'Engines offline'
    : busy
      ? 'Engine operation in progress'
      : unavailable
        ? 'Election / placement converging'
        : failed.length
          ? 'Degraded · awaiting recovery'
          : 'Cluster online';
  const canResize = !!cluster && !busy && online === count;
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div>
          <span className={styles.brand}>
            CAMUSDB <span>/</span> PLAYGROUND
          </span>
          <h1>A distributed database you can play with</h1>
        </div>
        <a href="/docs/browser-playground">Playground guide ↗</a>
      </header>
          <div className={styles.caption}>
            <span className={styles.badge}>REAL CAMUSDB via WASM</span> Live
            membership, placement, and elections · in-memory engines in this tab{' '}
            <a href="/docs/browser-playground#data-center">How it works ↗</a>
          </div>
          <section className={`${styles.sessionStatus} ${starting ? styles.sessionStarting : ''}`} aria-label="Cluster session status">
            <div className={styles.sessionHeading} role="status">
              <span className={busy ? styles.spinner : styles.statusMark} aria-hidden="true">{busy ? '' : lab.error ? '!' : '✓'}</span>
              <div>
                <strong>{starting ? 'Preparing your cluster' : lab.startup === 'error' ? 'Cluster startup failed' : busy ? 'Working…' : lab.error ? 'Operation failed' : 'Cluster ready'}</strong>
                <p>{starting || busy ? lab.message : lab.error || `${online} servers online · SQL is ready to run`}</p>
              </div>
              {lab.startup === 'error' ? <button disabled={busy} onClick={lab.start}>Retry startup</button> : <span className={styles.sessionHint}>{starting ? 'You can edit SQL and explore examples while you wait.' : 'Select a server to choose your query coordinator.'}</span>}
            </div>
            {starting && <ol className={styles.startupSteps} aria-label="Startup progress">
              {['loading', 'starting', 'seeding'].map((step, i) => {
                const current = ['loading', 'starting', 'seeding'].indexOf(lab.startup);
                return <li key={step} aria-current={current === i ? 'step' : undefined} data-complete={current > i}>
                  <span>{current > i ? '✓' : i + 1}</span>
                  {['Load engine', 'Start servers', 'Load sample data'][i]}
                  {step === 'loading' && current === 0 && lab.download && <small>{lab.download.loaded}/{lab.download.total} files</small>}
                </li>;
              })}
            </ol>}
          </section>
          <div className={styles.workspace}>
          <section className={styles.console} aria-label="Data center SQL">
            <div className={styles.panelTitle}>
              <div><h2>SQL console</h2><span className={styles.note}>playground / {nodeName(inspect)}</span></div>
              <button
                disabled={busy || lab.startup !== 'ready' || !node?.running || !lab.sql.trim()}
                onClick={() => lab.query(inspect)}
              >
                {starting ? 'Starting cluster…' : 'Run query'}
              </button>
            </div>
            <div className={styles.examples}>
              <span>SQL examples</span>
              {defaultExamples.map((example) => (
                <button key={example.label} aria-pressed={lab.sql === example.sql} onClick={() => lab.setSql(example.sql)}>{example.label}</button>
              ))}
              <button onClick={() => lab.setSql("CREATE TABLE quick_notes (id INT64 PRIMARY KEY, message STRING);\nINSERT INTO quick_notes (id, message) VALUES (1, 'Hello, CamusDB!');\nSELECT * FROM quick_notes;")}>Create a table</button>
              <button onClick={() => lab.setSql('SELECT * FROM quick_notes;')}>Read rows</button>
            </div>
            <p className={styles.note}>Sample library: 15 books · 7 authors. Choose an example, then run it.</p>
            <div className={styles.sqlEditor}>
            <HighlightedSql code={lab.sql} highlightRef={highlightRef} light />
            <textarea
              className={styles.sql}
              ref={editorRef}
              aria-label="Data center SQL"
              value={lab.sql}
              onChange={(e) => lab.setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (!busy && lab.startup === 'ready' && node?.running && lab.sql.trim()) lab.query(inspect);
                }
              }}
              onScroll={(e) => {
                if (highlightRef.current) highlightRef.current.style.transform = `translate(${-e.currentTarget.scrollLeft}px, ${-e.currentTarget.scrollTop}px)`;
              }}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            </div>
            <p className={styles.note}>
              Cmd/Ctrl + Enter to run · Select a server to route your query.
            </p>
            <div className={styles.queryResults} role="region" aria-label="Query results">
              {!lab.results.length && <div className={styles.empty}><strong>{starting ? 'Getting ready to run your SQL…' : 'Your results appear here'}</strong><p>{starting ? 'Choose an example now. Run query will activate when startup completes.' : 'Run SQL, change the cluster, and see what happens.'}</p></div>}
              {lab.results.map((outcome, i) => (
                <div key={i} className={styles.queryResponse}>
                  <div className={styles.responseSource}>
                    <strong>Served by {nodeName(outcome.servedBy)}</strong>
                    <span>Query coordinator</span>
                  </div>
                  <ResultCard outcome={outcome} />
                </div>
              ))}
            </div>
          </section>

            <section className={styles.scenePanel} aria-label="Data center">
              <div className={styles.sceneTop}>
                <span className={unavailable ? styles.danger : styles.healthy}>
                  ● {status}
                </span>
                <span>
                  RF 3 <b> / </b> {partitions.length} DATA PARTITIONS
                </span>
              </div>
              <div className={styles.stats}>
                <div>
                  <small>VOTERS</small>
                  <strong>
                    {online}
                    <span> / {count}</span>
                  </strong>
                </div>
                <div>
                  <small>ROSTER VERSION</small>
                  <strong>{cluster?.membershipVersion ?? '—'}</strong>
                </div>
                <div>
                  <small>PARTITIONS WITH A LEADER</small>
                  <strong>
                    {partitions.length - unavailable}
                    <span> / {partitions.length}</span>
                  </strong>
                </div>
                <div>
                  <small>DESIRED SIZE</small>
                  <strong>
                    {desired}
                    <span> nodes</span>
                  </strong>
                </div>
              </div>
              <div
                className={styles.scene}
                aria-label="Interactive 3D server racks"
                onPointerDown={(e) => {
                  if (e.target.closest('button')) return;
                  setDrag({x: e.clientX, rotation});
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (drag) setRotation(Math.max(-75, Math.min(30, drag.rotation + (e.clientX - drag.x) / 4)));
                }}
                onPointerUp={() => setDrag(null)}
                onPointerCancel={() => setDrag(null)}
                style={{'--orbit': `${rotation}deg`, '--counter-orbit': `${-rotation}deg`, '--zoom': zoom}}
              >
                <div className={styles.world}>
                  <div className={styles.floor} />
                  <svg className={styles.connections} viewBox="0 0 540 540" aria-hidden="true">
                    {slots.filter((p) => p.id < count).flatMap((p) =>
                      layer === 'traffic' ? [
                        <path key={p.id} d={`M270 20 Q${p.x} 20 ${p.x + 30} ${p.y + 30}`} className={!failed.includes(p.id) ? styles.flow : undefined} />,
                      ] : slots.filter((q) => q.id > p.id && q.id < count && partitions.some((part) => part.replicas.includes(p.id) && part.replicas.includes(q.id))).map((q) =>
                        <path key={`${p.id}-${q.id}`} d={`M${p.x + 30} ${p.y + 30} L${q.x + 30} ${q.y + 30}`} className={!failed.includes(p.id) && !failed.includes(q.id) ? styles.flow : undefined} />
                      )
                    )}
                  </svg>
                  {slots.map((p) => {
                    const joining = lab.joiningNode === p.id || (nodes[p.id]?.running && nodes[p.id]?.role !== 'Voter');
                    const visible = joining || p.id < count || (!cluster && busy && p.id < MIN);
                    const down = failed.includes(p.id);
                    return <div key={p.id} className={styles.serverPosition} style={{left: p.x, top: p.y}}>
                      {visible ? <>
                        <button
                          className={`${styles.server} ${inspect === p.id ? styles.selectedServer : ''} ${down ? styles.failedServer : ''} ${joining ? styles.joiningServer : ''}`}
                          data-joining={joining || undefined}
                          aria-label={joining ? `${nodeName(p.id)} joining cluster` : `Inspect ${nodeName(p.id)}`}
                          aria-pressed={inspect === p.id}
                          disabled={!cluster || joining}
                          onClick={() => setSelected(p.id)}
                        >
                          <span className={styles.serverTop}><span>{down ? 'DOWN' : joining ? 'JOINING' : inspect === p.id ? 'SELECTED' : 'CAMUS'}</span></span>
                          <span className={styles.serverSide} />
                          <span className={styles.serverBack} />
                          <span className={styles.serverLeft} />
                          <span className={styles.serverFront}>
                            <span className={styles.serverName}>{nodeName(p.id)}</span>
                            {(partitions.length ? partitions : Array.from({length: 8}, (_, id) => ({id, replicas: [], leader: null}))).map((part) => {
                              const role = down ? 'offline' : part.leader === p.id ? 'leader' : part.replicas.includes(p.id) ? 'follower' : 'absent';
                              const label = `P${part.id}: ${role === 'absent' ? 'not hosted' : role}`;
                              return <span className={styles.drive} data-role={role} key={part.id} title={label} aria-label={label}><i /><span>P{part.id}</span><b>{role === 'leader' ? 'L' : role === 'follower' ? 'F' : '–'}</b></span>;
                            })}
                          </span>
                        </button>
                        {down && <div className={styles.fire} role="img" aria-label={`${nodeName(p.id)} is down`}>
                          {Array.from({length: 12}, (_, spark) => <i key={spark} style={{'--spark-x': `${(spark * 17) % 48 - 24}px`, '--drift': `${(spark % 3 - 1) * 16}px`, '--delay': `${-spark * .19}s`, '--duration': `${1.1 + (spark % 4) * .2}s`}} />)}
                        </div>}
                      </> : <div className={styles.expansion}>0{p.id + 1}</div>}
                    </div>;
                  })}
                </div>
              </div>
              <div className={styles.bladeLegend} aria-label="Partition blade colors">
                <span><i data-role="leader" /> Leader · L</span>
                <span><i data-role="follower" /> Follower · F</span>
                <span><i data-role="absent" /> Not hosted · –</span>
                <span><i data-role="offline" /> Down</span>
              </div>
              {lab.joiningNode !== null && <p className={styles.joiningNotice} role="status"><span className={styles.spinner} aria-hidden="true" />{nodeName(lab.joiningNode)} is joining · catching up before becoming available</p>}
              <div className={styles.selectedNode} aria-live="polite">
                <strong>{nodeName(inspect)}</strong>
                <span>{!cluster ? 'Starting…' : failed.includes(inspect) ? 'Unreachable' : node?.role !== 'Voter' ? 'Joining…' : `${partitions.filter((part) => part.leader === inspect).length} leaders · ${node?.hosts.length ?? 0} partitions`}</span>
                <span>Selected server</span>
              </div>
              <div className={styles.sceneBottom}>
                <div className={styles.modes}>
                  <button
                    aria-pressed={layer === 'traffic'}
                    onClick={() => setLayer('traffic')}
                  >
                    Traffic
                  </button>
                  <button
                    aria-pressed={layer === 'replication'}
                    onClick={() => setLayer('replication')}
                  >
                    Replication
                  </button>
                </div>
                <div>
                  <button aria-label="Rotate scene left" onClick={() => setRotation((r) => Math.max(-75, r - 15))}>↶</button>
                  <button aria-label="Rotate scene right" onClick={() => setRotation((r) => Math.min(30, r + 15))}>↷</button>
                  <button
                    aria-label="Zoom out"
                    onClick={() => setZoom((z) => Math.max(.8, z - .1))}
                  >
                    −
                  </button>
                  <button
                    aria-label="Reset camera"
                    onClick={() => { setRotation(-30); setZoom(1); }}
                  >
                    ⌖
                  </button>
                  <button
                    aria-label="Zoom in"
                    onClick={() => setZoom((z) => Math.min(1.3, z + .1))}
                  >
                    +
                  </button>
                </div>
                <span>Drag to orbit · Click a server to inspect</span>
              </div>
              <p className={styles.sceneNote}>
                {layer === 'traffic'
                  ? 'Paths illustrate client routing, not measured packets. Select a server to see its leaders and hosted partitions.'
                  : 'Links connect nodes sharing committed replicas. Placement and leadership come from the engines.'}
              </p>
            </section>
          </div>
            <aside className={styles.sidebar}>
              <section className={styles.panel}>
                <div className={styles.panelTitle}>
                  <h2>Cluster controls</h2>
                  <span className={styles.healthy}>WebAssembly</span>
                </div>
                {!cluster ? (
                  <button
                    className={styles.recover}
                    disabled={busy}
                    onClick={lab.start}
                  >
                    {busy ? 'Starting data center…' : 'Retry startup'}
                  </button>
                ) : (
                  <>
                    <div className={styles.manual}>
                      <button
                        aria-label="Remove one node"
                        disabled={!canResize || count <= MIN}
                        onClick={() => lab.resize(-1)}
                      >
                        −
                      </button>
                      <span>{count} engines</span>
                      <button
                        aria-label="Add one node"
                        disabled={!canResize || count >= MAX}
                        onClick={() => lab.resize(1)}
                      >
                        +
                      </button>
                    </div>
                    <p className={styles.note}>
                      New engines join as learners and catch up. Removal asks
                      CamusDB to drain the highest ordinal before stopping it.
                    </p>
                    <div className={styles.toggle}>
                      <span>Follow simulated demand</span>
                      <button
                        disabled={busy}
                        aria-pressed={auto}
                        onClick={() => setAuto(!auto)}
                      >
                        {auto ? 'Enabled' : 'Manual'}
                      </button>
                    </div>
                    {auto && (
                      <>
                        <label className={styles.sliderLabel} htmlFor="traffic">
                          Synthetic demand{' '}
                          <strong>{traffic.toLocaleString()} units/s</strong>
                        </label>
                        <input
                          id="traffic"
                          type="range"
                          min="2000"
                          max="48000"
                          step="1000"
                          value={traffic}
                          onChange={(e) => setTraffic(Number(e.target.value))}
                        />
                        <div className={styles.presets}>
                          {[
                            ['Quiet', 6000],
                            ['Steady', 16000],
                            ['Traffic spike', 40000],
                          ].map(([name, value]) => (
                            <button
                              key={name}
                              onClick={() => setTraffic(value)}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                        <p className={styles.note}>
                          Synthetic demand only chooses the requested size (4–9
                          nodes, target 4,000 units/node). Every join and leave
                          runs in the real engine. Wait: 4s up / 10s down, then
                          engine convergence.
                        </p>
                        <p className={styles.note}>
                          Recommended: {desired} nodes · stabilization{' '}
                          {lab.streak}s
                        </p>
                      </>
                    )}
                  </>
                )}
                <div className={styles.decision} role="status">
                  {lab.message}
                </div>
                {lab.error && (
                  <p className={styles.danger} role="alert">
                    {lab.error}
                  </p>
                )}
                <p className={styles.note}>
                  Eight placed data partitions · replication factor 3 · metadata
                  replicated across the committed roster. Data resets on reload.
                </p>
              </section>
              <section className={styles.panel} aria-label="Node inspector">
                <div className={styles.panelTitle}>
                  <h2>{nodeName(inspect)}</h2>
                  <span
                    className={
                      failed.includes(inspect) ? styles.danger : styles.healthy
                    }
                  >
                    {node?.role ?? (busy ? 'Starting' : 'Offline')}
                  </span>
                </div>
                <span className={styles.note}>ENGINE-REPORTED STATE</span>
                <dl>
                  <div>
                    <dt>Node / endpoint</dt>
                    <dd>
                      {inspect} / {node?.endpoint ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Local layout</dt>
                    <dd>In-memory KV + Raft log</dd>
                  </div>
                  <div>
                    <dt>Metadata membership</dt>
                    <dd>
                      {cluster?.members.filter((m) => m.role === 'Voter')
                        .length ?? 0}{' '}
                      voters · v{cluster?.membershipVersion ?? 0}
                    </dd>
                  </div>
                  <div>
                    <dt>Data replicas hosted</dt>
                    <dd>
                      {hosted.length} / {partitions.length} partitions
                    </dd>
                  </div>
                </dl>
                <div className={styles.partitionGrid}>
                  {partitions.map((p) => (
                    <span
                      key={p.id}
                      className={
                        p.replicas.includes(inspect)
                          ? p.leader === inspect
                            ? styles.leader
                            : styles.replica
                          : styles.absent
                      }
                      title={`P${p.id}: replicas ${p.replicas.join(', ')}; leader ${p.leader ?? 'unavailable'}`}
                    >
                      P{p.id}
                    </span>
                  ))}
                </div>
                <p className={styles.legend}>
                  <i /> Leader <i /> Follower <i /> Not hosted
                </p>
                <button
                  className={
                    failed.includes(inspect) ? styles.recover : styles.fault
                  }
                  disabled={
                    busy ||
                    !cluster ||
                    (!!node?.running && online - 1 < Math.floor(count / 2) + 1)
                  }
                  onClick={() => lab.fault(inspect)}
                >
                  {failed.includes(inspect)
                    ? 'Restart node'
                    : 'Simulate node failure'}
                </button>
                <p className={styles.note}>
                  Stop a node to exercise real failover. Restart brings back an
                  empty engine to recover from peers. Keep a connected majority
                  online.
                </p>
              </section>
            </aside>
          <section className={styles.eventPanel} aria-label="Engine events">
            <div className={styles.panelTitle}>
              <h2>
                Engine journal <span> / LIVE</span>
              </h2>
              <button
                disabled={busy}
                onClick={() => {
                  lab.start();
                  setSelected(0);
                }}
              >
                Reset data center
              </button>
            </div>
            <div className={styles.events} role="log" aria-live="polite">
              {lab.events.length ? (
                lab.events.map((e, i) => (
                  <div key={e.id}>
                    <span>
                      {String(lab.events.length - i).padStart(2, '0')}
                    </span>
                    <span>{e.text}</span>
                  </div>
                ))
              ) : (
                <p>
                  Membership, leadership, and placement changes appear here.
                </p>
              )}
            </div>
          </section>
          <footer className={styles.footer}>
            Real CamusDB + Raft · browser WebAssembly · in-memory transport.
            Animations illustrate topology, not measured packets.{' '}
            <a href="https://github.com/camusdb/camusdb">
              Explore the engine ↗
            </a>
          </footer>
    </div>
  );
}
