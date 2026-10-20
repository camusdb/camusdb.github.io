import {useEffect, useRef, useState} from 'react';
import {loadEngine} from '../CamusPlayground/runtime';
import {defaultSeedScript} from '../CamusPlayground';
import {recommendation} from './model';

export default function useCluster(active) {
  const [cluster, setCluster] = useState(null);
  const [busy, setBusy] = useState(true);
  const [startup, setStartup] = useState('loading');
  const [download, setDownload] = useState(null);
  const [message, setMessage] = useState(
    'Starting four real CamusDB servers in this tab…',
  );
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [auto, setAuto] = useState(false);
  const [traffic, setTraffic] = useState(14000);
  const [streak, setStreak] = useState(0);
  const api = useRef(null);
  const lock = useRef(false);
  const pendingPoll = useRef(null);
  const mounted = useRef(true);
  const previous = useRef(null);
  const nextEvent = useRef(0);
  const stabilization = useRef({direction: 0, ticks: 0});
  const [sql, setSql] = useState('SHOW DATABASES;');
  const [results, setResults] = useState([]);
  const [joiningNode, setJoiningNode] = useState(null);
  function log(text) {
    if (mounted.current)
      setEvents((old) =>
        [{id: ++nextEvent.current, text}, ...old].slice(0, 40),
      );
  }
  function accept(next) {
    if (!mounted.current) return;
    const old = previous.current;
    if (old) {
      if (old.membershipVersion !== next.membershipVersion)
        log(
          `Committed roster v${next.membershipVersion}: ${next.members.map((m) => `${m.endpoint} ${m.role}`).join(' · ')}`,
        );
      for (let p = 0; p < next.partitionCount; p++) {
        const leaders = (status) =>
          status.nodes
            .filter((n) => n.running && n.leads.includes(p))
            .map((n) => n.index)
            .join(',');
        if (leaders(old) !== leaders(next))
          log(`P${p} leader claims → ${leaders(next) || 'electing'}`);
      }
      for (const part of next.partitions || []) {
        const before = old.partitions?.find((p) => p.id === part.id);
        if (
          before &&
          JSON.stringify(before.replicas) !== JSON.stringify(part.replicas)
        )
          log(
            `P${part.id} placement → ${part.replicas.map((r) => `${r.index}:${r.role}`).join(', ')}`,
          );
      }
    }
    previous.current = next;
    setCluster(next);
  }
  async function action(text, work, isStartup = false) {
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
          'Server state refreshed. CamusDB handles elections and placement.',
        );
    } catch (err) {
      if (mounted.current) {
        setError(err.message);
        if (isStartup) setStartup('error');
        log(err.message);
      }
      // A timeout may follow a committed membership change. Read the engine instead of
      // rolling the UI back to an invented topology.
      if (api.current)
        try {
          accept(JSON.parse(await api.current.ClusterStatusAsync()));
        } catch {}
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function start() {
    return action(
      'Loading WebAssembly and starting four placed nodes…',
      async () => {
        setStartup('loading');
        setDownload(null);
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        api.current = await loadEngine((loaded, total) => {
          if (mounted.current) {
            setDownload({loaded, total});
            setMessage(`Downloading WebAssembly · ${loaded}/${total} resources`);
          }
        });
        if (!mounted.current) return;
        previous.current = null;
        setCluster(null);
        setResults([]);
        setAuto(false);
        setStartup('starting');
        setMessage('Starting four servers and electing partition leaders…');
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        accept(JSON.parse(await api.current.StartElasticClusterAsync(4)));
        if (mounted.current) {
          setStartup('seeding');
          setMessage('Loading the sample books and authors…');
        }
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const seeded = JSON.parse(await api.current.ExecuteOnNodeAsync(0, defaultSeedScript, 'playground'));
        const failure = seeded.find((outcome) => !outcome.ok);
        if (failure) throw new Error(`Sample library could not load: ${failure.message}`);
        accept(JSON.parse(await api.current.ClusterStatusAsync()));
        log(
          'Four real nodes started · eight data partitions · replication factor 3',
        );
        if (mounted.current) setStartup('ready');
      },
      true,
    );
  }
  function resize(direction) {
    return action(
      direction > 0
        ? 'Joining a new server as a learner; waiting for voter promotion…'
        : 'Draining the highest ordinal and committing its removal…',
      async () => {
        if (direction > 0) {
          setJoiningNode(previous.current.nodes.length);
          // Paint the pending server before the engine begins its join operation.
          await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        }
        try {
          accept(
            JSON.parse(
              await api.current[
                direction > 0 ? 'AddClusterNodeAsync' : 'RemoveClusterNodeAsync'
              ](),
            ),
          );
          log(
            direction > 0
              ? 'New server joined and promoted to voter'
              : 'Node drained and removed from the committed roster',
          );
          stabilization.current = {direction: 0, ticks: 0};
          setStreak(0);
        } finally {
          if (mounted.current) setJoiningNode(null);
        }
      },
    );
  }
  function fault(id) {
    return action('Changing node availability…', async () => {
      const restarting = !cluster.nodes[id].running;
      accept(
        JSON.parse(
          await api.current[restarting ? 'StartNodeAsync' : 'StopNodeAsync'](
            id,
          ),
        ),
      );
      log(
        `camusdb-${id} ${restarting ? 'restarted empty; server catches up from peers' : 'stopped; surviving servers handle failover'}`,
      );
    });
  }
  function query(id) {
    return action(`Running SQL through camusdb-${id}…`, async () => {
      const outcomes = JSON.parse(
        await api.current.ExecuteOnNodeAsync(id, sql, 'playground'),
      );
      if (mounted.current) setResults(outcomes.map((outcome) => ({...outcome, servedBy: id})));
      log(
        `camusdb-${id} returned ${outcomes.some((o) => !o.ok) ? 'a SQL error' : 'query results'}`,
      );
      accept(JSON.parse(await api.current.ClusterStatusAsync()));
    });
  }
  async function stop() {
    if (lock.current) return false;
    await action('Stopping the data center servers…', async () => {
      if (api.current) await api.current.StopClusterAsync();
      previous.current = null;
      setCluster(null);
      setAuto(false);
      setResults([]);
    });
    return true;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      api.current?.StopClusterAsync().catch(() => {});
    };
  }, []);
  // Start once on entry.
  // Failed starts remain visible for an explicit retry instead of looping downloads.
  useEffect(() => {
    if (active) start();
  }, [active]);
  useEffect(() => {
    if (!active || !cluster) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (lock.current || pendingPoll.current) return;
      pendingPoll.current = (async () => {
        try {
          const next = JSON.parse(await api.current.ClusterStatusAsync());
          if (!cancelled) accept(next);
        } catch (err) {
          if (!cancelled && mounted.current) setError(err.message);
        }
      })();
      await pendingPoll.current;
      pendingPoll.current = null;
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, !!cluster]);
  useEffect(() => {
    stabilization.current = {direction: 0, ticks: 0};
    setStreak(0);
    if (!active || !auto || !cluster || busy) return;
    const timer = setInterval(() => {
      const currentCluster = previous.current;
      if (!currentCluster) return;
      const healthy = currentCluster.nodes.every(
        (n) => n.running && n.role === 'Voter',
      );
      const target = recommendation(currentCluster.nodes.length, traffic);
      const direction = healthy
        ? Math.sign(target - currentCluster.nodes.length)
        : 0;
      const current = stabilization.current;
      current.ticks = direction
        ? direction === current.direction
          ? current.ticks + 1
          : 1
        : 0;
      current.direction = direction;
      setStreak(current.ticks);
      if (direction && current.ticks >= (direction > 0 ? 4 : 10))
        resize(direction);
    }, 1000);
    return () => clearInterval(timer);
  }, [active, auto, traffic, cluster?.nodes.length, busy]);
  return {
    cluster,
    startup,
    download,
    busy,
    message,
    error,
    events,
    auto,
    setAuto,
    traffic,
    setTraffic,
    streak,
    start,
    resize,
    fault,
    query,
    stop,
    sql,
    setSql,
    results,
    joiningNode,
  };
}
