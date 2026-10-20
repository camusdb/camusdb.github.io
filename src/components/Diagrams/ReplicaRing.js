import React from 'react';
import styles from './styles.module.css';
import {Defs, Icon, Label, TextLines, fitText, listText, measureLabel, normalize, textWidth, useDiagramId} from './shared';

// Replica ring: the nodes of one replica group sit on a circle. The leader is
// drawn as a dark box and, by default, replicates to every follower. With
// edges="ring" the arrows run node to node around the circle instead. An
// optional client box on the left sends its requests to the leader.
const CARD = {w: 230, minH: 84, padY: 32, iconX: 18, iconSize: 40, textX: 70};
const CLIENT = {w: 200, minH: 70, gap: 110, textX: 70};
const MARGIN = 14;
const CARD_GAP = 24;

function overlaps(a, b, gap) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;
}

// Smallest radius at which no two cards (or a card and the center label) touch.
function ringRadius(count, startAngle, cardH, pill) {
  for (let r = 150; r < 1000; r += 5) {
    const rects = Array.from({length: count}, (_, i) => {
      const a = startAngle + (2 * Math.PI * i) / count;
      return {x: r * Math.cos(a), y: r * Math.sin(a), w: CARD.w, h: cardH};
    });
    if (pill) rects.push({x: 0, y: 0, w: pill.w, h: pill.h});
    const clear = rects.every((a, i) => rects.every((b, j) => j <= i || !overlaps(a, b, CARD_GAP)));
    if (clear) return r;
  }
  return 1000;
}

// Where a ray from a box center towards (dx, dy) leaves the box, plus margin.
function boxExit(box, dx, dy, margin) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const t = Math.min(ux ? (box.w / 2 + margin) / Math.abs(ux) : Infinity, uy ? (box.h / 2 + margin) / Math.abs(uy) : Infinity);
  return {x: box.x + ux * t, y: box.y + uy * t};
}

// Angular offset along the circle at which the arc leaves a card.
function arcExit(r, angle, direction, cardH, margin) {
  const cx = r * Math.cos(angle);
  const cy = r * Math.sin(angle);
  for (let d = 0; d < Math.PI; d += 0.004) {
    const a = angle + direction * d;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    if (Math.abs(x - cx) > CARD.w / 2 + margin || Math.abs(y - cy) > cardH / 2 + margin) return a;
  }
  return angle;
}

// Control point for a leader-to-follower spoke, or null when a straight line
// is clear. A blocked spoke bends, preferably away from the ring center, just
// far enough to miss the center label and the other cards. It asks for wide
// clearance first, then narrow clearance, and as a last resort takes the
// candidate that crosses the fewest obstacles.
function spokeControl(from, to, center, obstacles) {
  const hits = (ctrl, gap) => {
    let count = 0;
    for (let t = 0.1; t <= 0.9; t += 0.02) {
      const u = 1 - t;
      const point = ctrl
        ? {x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x, y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y}
        : {x: u * from.x + t * to.x, y: u * from.y + t * to.y};
      if (obstacles.some((o) => overlaps({...point, w: 0, h: 0}, o, gap))) count++;
    }
    return count;
  };

  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const mid = {x: (from.x + to.x) / 2, y: (from.y + to.y) / 2};
  const nx = -(to.y - from.y) / len;
  const ny = (to.x - from.x) / len;
  const outward = nx * (mid.x - center.x) + ny * (mid.y - center.y) < 0 ? -1 : 1;
  const candidates = [null];
  for (const side of [outward, -outward]) {
    for (let k = 0.1; k <= 0.8; k += 0.05) {
      candidates.push({x: mid.x + side * nx * k * len, y: mid.y + side * ny * k * len});
    }
  }

  for (const gap of [18, 8]) {
    const found = candidates.find((ctrl) => hits(ctrl, gap) === 0);
    if (found !== undefined) return found;
  }
  let best = candidates[0];
  for (const ctrl of candidates) {
    if (hits(ctrl, 0) < hits(best, 0)) best = ctrl;
  }
  return best;
}

function layout({nodes, leader, center, client, edges}) {
  const count = nodes.length;
  const leaderIndex = leader ?? Math.max(0, nodes.findIndex((n) => n.role === 'leader'));
  // Rotate so the leader comes first; it is drawn on the left when there is a
  // client to face, and at the top otherwise.
  const ordered = nodes.slice(leaderIndex).concat(nodes.slice(0, leaderIndex));
  const startAngle = client ? Math.PI : -Math.PI / 2;

  // Leader mode labels each node with its role unless the node sets its own sub.
  const defaultSub = (i) => (edges === 'ring' ? undefined : i === 0 ? 'Leader' : 'Follower');
  const measured = ordered.map((n, i) =>
    measureLabel(n.label, n.sub === undefined ? defaultSub(i) : n.sub, {
      maxWidth: CARD.w - CARD.textX - 14,
      labelSize: 22,
      subSize: 17,
    }),
  );
  const cardH = Math.max(CARD.minH, ...measured.map((m) => m.height + CARD.padY));

  const centerFit = fitText(center, {maxWidth: 170, fontSize: 20, minFontSize: 16, maxLines: 2, bold: true});
  const pill = centerFit && {
    w: Math.max(...centerFit.lines.map((l) => textWidth(l, centerFit.fontSize, true))) + 44,
    h: centerFit.height + 24,
  };

  const r = count > 1 ? ringRadius(count, startAngle, cardH, pill) : 0;
  const angles = ordered.map((_, i) => startAngle + (2 * Math.PI * i) / count);
  let cards = ordered.map((n, i) => ({...n, measured: measured[i], angle: angles[i], x: r * Math.cos(angles[i]), y: r * Math.sin(angles[i]), w: CARD.w, h: cardH}));

  const clientItem = client && normalize(client);
  const clientFit = clientItem && fitText(clientItem.label, {maxWidth: CLIENT.w - CLIENT.textX - 12, fontSize: 22, minFontSize: 16, maxLines: 3, bold: true});
  const clientH = clientFit ? Math.max(CLIENT.minH, clientFit.height + 28) : 0;

  // Everything so far is relative to the ring center; shift it into view.
  const minX = Math.min(...cards.map((c) => c.x - c.w / 2), -r) - (clientItem ? CLIENT.w + CLIENT.gap : 0);
  const maxX = Math.max(...cards.map((c) => c.x + c.w / 2), r);
  const minY = Math.min(...cards.map((c) => c.y - c.h / 2), -r);
  const maxY = Math.max(...cards.map((c) => c.y + c.h / 2), r);
  const ox = MARGIN - minX;
  const oy = MARGIN - minY;
  cards = cards.map((c) => ({...c, x: c.x + ox, y: c.y + oy}));
  const cx = ox;
  const cy = oy;

  const arrows = [];
  if (edges === 'leader') {
    const from = cards[0];
    const pillBox = pill && {x: cx, y: cy, w: pill.w, h: pill.h};
    for (const to of cards.slice(1)) {
      const obstacles = cards.filter((c) => c !== from && c !== to).concat(pillBox ? [pillBox] : []);
      const ctrl = spokeControl(from, to, {x: cx, y: cy}, obstacles);
      const aim = (box, target) => boxExit(box, target.x - box.x, target.y - box.y, 6);
      const p1 = aim(from, ctrl ?? to);
      const p2 = aim(to, ctrl ?? from);
      arrows.push(ctrl ? `M${p1.x},${p1.y} Q${ctrl.x},${ctrl.y} ${p2.x},${p2.y}` : `M${p1.x},${p1.y} L${p2.x},${p2.y}`);
    }
  } else if (edges === 'ring' && count > 1) {
    const pairs = count === 2 ? [[0, 1], [1, 0]] : cards.map((_, i) => [i, (i + 1) % count]);
    for (const [i, j] of pairs) {
      const a1 = arcExit(r, cards[i].angle, 1, cardH, 8);
      let a2 = arcExit(r, cards[j].angle, -1, cardH, 8);
      if (a2 < a1) a2 += 2 * Math.PI;
      const p1 = {x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1)};
      const p2 = {x: cx + r * Math.cos(a2), y: cy + r * Math.sin(a2)};
      arrows.push(`M${p1.x},${p1.y} A${r},${r} 0 ${a2 - a1 > Math.PI ? 1 : 0} 1 ${p2.x},${p2.y}`);
    }
  }

  const clientBox = clientItem && {
    ...clientItem,
    fit: clientFit,
    x: MARGIN,
    y: cy - clientH / 2,
    w: CLIENT.w,
    h: clientH,
  };

  return {cards, cardH, r, cx, cy, arrows, pill, centerFit, clientBox, width: maxX + ox + MARGIN, height: maxY - minY + 2 * MARGIN};
}

export default function ReplicaRing({nodes = [], leader, center, client, edges = 'leader', title}) {
  const id = useDiagramId();
  const items = nodes.map(normalize);
  const {cards, r, cx, cy, arrows, pill, centerFit, clientBox, width, height} = layout({nodes: items, leader, center, client, edges});
  const [lead, ...followers] = cards;
  const label =
    title ??
    (edges === 'ring'
      ? `${listText(cards.map((c) => c.label))} form a ring${center ? ` for ${center}` : ''}.`
      : `${lead?.label} is the leader${center ? ` of ${center}` : ''} and replicates to ${listText(followers.map((c) => c.label))}.`);

  return (
    <figure className={styles.figure}>
      <div className={styles.scroll}>
        <svg className={styles.svg} style={{maxWidth: width * 0.85}} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
          <Defs id={id} />

          {cards.length > 1 && <circle className={styles.ring} cx={cx} cy={cy} r={r} />}

          {arrows.map((d, i) => (
            <path key={i} className={styles.edge} d={d} markerEnd={`url(#${id}-arrow)`} />
          ))}

          {clientBox && lead && (
            <>
              <path
                className={styles.edge}
                d={`M${clientBox.x + clientBox.w},${cy} L${lead.x - lead.w / 2 - 2},${cy}`}
                markerEnd={`url(#${id}-arrow)`}
              />
              <rect className={styles.source} x={clientBox.x} y={clientBox.y} width={clientBox.w} height={clientBox.h} rx="12" />
              <Icon name={clientBox.icon ?? 'user'} x={clientBox.x + 22} y={cy - 17} size={34} />
              <TextLines fit={clientBox.fit} x={clientBox.x + CLIENT.textX} y={cy - clientBox.fit.height / 2} className={styles.sourceLabel} />
            </>
          )}

          {cards.map((c, i) => {
            const isLeader = i === 0 && edges !== 'ring';
            const x = c.x - c.w / 2;
            const y = c.y - c.h / 2;
            return (
              <g key={i} className={isLeader ? styles.inverse : undefined}>
                <rect
                  className={isLeader ? styles.hub : styles.source}
                  x={x}
                  y={y}
                  width={c.w}
                  height={c.h}
                  rx="14"
                  fill={isLeader ? `url(#${id}-hub)` : undefined}
                />
                <Icon name={c.icon ?? 'server'} x={x + CARD.iconX} y={c.y - CARD.iconSize / 2} size={CARD.iconSize} />
                <Label
                  measured={c.measured}
                  x={x + CARD.textX}
                  cy={c.y}
                  labelClass={isLeader ? styles.hubLabel : styles.sourceLabel}
                  subClass={isLeader ? styles.leaderSub : styles.targetSub}
                />
              </g>
            );
          })}

          {pill && (
            <>
              <rect className={styles.pill} x={cx - pill.w / 2} y={cy - pill.h / 2} width={pill.w} height={pill.h} rx={Math.min(pill.h / 2, 22)} />
              <TextLines fit={centerFit} x={cx} y={cy - centerFit.height / 2} className={styles.pillLabel} anchor="middle" />
            </>
          )}
        </svg>
      </div>
    </figure>
  );
}
