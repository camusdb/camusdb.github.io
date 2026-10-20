import React from 'react';
import styles from './styles.module.css';
import {Defs, Icon, Label, TextLines, fitText, listText, measureLabel, normalize, useDiagramId} from './shared';

// Fan-in architecture diagram: sources on the left feed a hub inside a group,
// and the hub feeds stacked targets on the right. Everything is laid out in a
// fixed 1000-unit-wide viewBox and scales with the container. Boxes grow to
// fit their wrapped labels.
const W = 1000;
const SRC = {x: 10, w: 230, minH: 70, gap: 18, dotsH: 40, textX: 82, padY: 28};
const GROUP = {x: 330, w: 660, top: 10, titleTop: 22, titleGap: 20, padBottom: 30};
const HUB = {x: 370, w: 170, iconSize: 64, iconGap: 18};
const TGT = {x: 600, w: 360, gap: 30, maxH: 170, minH: 110, padY: 40};
const ELLIPSIS = new Set(['…', '...']);

function layout({sources, group, hub, targets}) {
  const title = fitText(group, {maxWidth: GROUP.w - 80, fontSize: 32, minFontSize: 24, maxLines: 2, bold: true});
  const titleH = title ? GROUP.titleTop + title.height + GROUP.titleGap : GROUP.titleTop;

  const srcItems = sources.map(normalize).map((s) => {
    if (ELLIPSIS.has(s.label)) return {...s, dots: true, h: SRC.dotsH};
    const fit = fitText(s.label, {maxWidth: SRC.w - SRC.textX - 12, fontSize: 24, minFontSize: 18, maxLines: 3, bold: true});
    return {...s, fit, h: Math.max(SRC.minH, fit.height + SRC.padY)};
  });
  const srcH = srcItems.reduce((sum, s) => sum + s.h, 0) + SRC.gap * Math.max(0, srcItems.length - 1);

  const hubFit = fitText(hub.label, {maxWidth: HUB.w - 28, fontSize: 26, minFontSize: 18, maxLines: 4, bold: true});
  const hubContentH = (hub.icon ? HUB.iconSize + HUB.iconGap : 0) + (hubFit?.height ?? 0);

  const tgtItems = targets.map(normalize).map((t) => {
    const textX = t.icon ? 130 : 40;
    const measured = measureLabel(t.label, t.sub, {maxWidth: TGT.w - textX - 20, labelSize: 26, subSize: 20});
    return {...t, textX, measured};
  });
  const tgtReqH = Math.max(TGT.minH, ...tgtItems.map((t) => t.measured.height + TGT.padY));
  const tgtGaps = TGT.gap * Math.max(0, tgtItems.length - 1);

  const contentH = Math.max(srcH, tgtItems.length * tgtReqH + tgtGaps, hubContentH + 80, 240);
  const hubTop = GROUP.top + titleH;
  const hubBottom = hubTop + contentH;

  let y = hubTop + (contentH - srcH) / 2;
  const placedSrc = srcItems.map((s) => {
    const placed = {...s, y};
    y += s.h + SRC.gap;
    return placed;
  });

  // Edges land on the hub at evenly spaced points, top to bottom.
  const real = placedSrc.filter((s) => !s.dots);
  const edges = real.map((s, i) => ({
    x1: SRC.x + SRC.w,
    y1: s.y + s.h / 2,
    x2: HUB.x,
    y2: hubTop + (contentH * (i + 1)) / (real.length + 1),
  }));

  const tH = tgtItems.length ? Math.max(tgtReqH, Math.min(TGT.maxH, (contentH - tgtGaps) / tgtItems.length)) : 0;
  const tTotal = tH * tgtItems.length + tgtGaps;
  const placedTgt = tgtItems.map((t, i) => ({
    ...t,
    y: hubTop + (contentH - tTotal) / 2 + i * (tH + TGT.gap),
    h: tH,
  }));

  const groupBottom = hubBottom + GROUP.padBottom;
  return {title, placedSrc, edges, hubFit, hubContentH, placedTgt, hubTop, hubBottom, groupBottom, height: groupBottom + 10};
}

function curve({x1, y1, x2, y2}) {
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 2},${y2}`;
}

export default function ArchDiagram({sources = [], group, hub = {}, targets = [], title}) {
  const id = useDiagramId();
  const {title: groupTitle, placedSrc, edges, hubFit, hubContentH, placedTgt, hubTop, hubBottom, groupBottom, height} = layout({
    sources,
    group,
    hub,
    targets,
  });
  const hubH = hubBottom - hubTop;
  const hubCx = HUB.x + HUB.w / 2;
  const hubContentTop = hubTop + (hubH - hubContentH) / 2;
  const label =
    title ??
    `${listText(placedSrc.filter((s) => !s.dots).map((s) => s.label))} connect to ${hub.label ?? 'the hub'}` +
      (group ? ` inside ${group}` : '') +
      (targets.length ? `, which writes to ${listText(placedTgt.map((t) => t.label))}.` : '.');

  return (
    <figure className={styles.figure}>
      <div className={styles.scroll}>
        <svg className={styles.svg} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
          <Defs id={id} />

          {group && (
            <>
              <rect className={styles.group} x={GROUP.x} y={GROUP.top} width={GROUP.w} height={groupBottom - GROUP.top} rx="18" />
              <TextLines fit={groupTitle} x={GROUP.x + 40} y={GROUP.top + GROUP.titleTop} className={styles.groupTitle} />
            </>
          )}

          {placedSrc.map((s, i) =>
            s.dots ? (
              <g key={i} className={styles.dots}>
                {[-14, 0, 14].map((dx) => (
                  <circle key={dx} cx={SRC.x + SRC.w / 2 + dx} cy={s.y + s.h / 2} r="4" />
                ))}
              </g>
            ) : (
              <g key={i}>
                <rect className={styles.source} x={SRC.x} y={s.y} width={SRC.w} height={s.h} rx="12" />
                <Icon name={s.icon ?? 'user'} x={SRC.x + 26} y={s.y + s.h / 2 - 18} size={36} />
                <TextLines fit={s.fit} x={SRC.x + SRC.textX} y={s.y + (s.h - s.fit.height) / 2} className={styles.sourceLabel} />
              </g>
            ),
          )}

          {edges.map((e, i) => (
            <path key={i} className={styles.edge} d={curve(e)} markerEnd={`url(#${id}-arrow)`} />
          ))}

          <rect className={styles.hub} x={HUB.x} y={hubTop} width={HUB.w} height={hubH} rx="16" fill={`url(#${id}-hub)`} />
          <g className={styles.inverse}>
            {hub.icon && <Icon name={hub.icon} x={hubCx - HUB.iconSize / 2} y={hubContentTop} size={HUB.iconSize} />}
            <TextLines
              fit={hubFit}
              x={hubCx}
              y={hubContentTop + (hub.icon ? HUB.iconSize + HUB.iconGap : 0)}
              className={styles.hubLabel}
              anchor="middle"
            />
          </g>

          {placedTgt.map((t, i) => {
            const cy = t.y + t.h / 2;
            return (
              <g key={i}>
                <path className={styles.edge} d={`M${HUB.x + HUB.w},${cy} L${TGT.x - 2},${cy}`} markerEnd={`url(#${id}-arrow)`} />
                <rect className={styles.target} x={TGT.x} y={t.y} width={TGT.w} height={t.h} rx="14" />
                {t.icon && <Icon name={t.icon} x={TGT.x + 40} y={cy - 32} size={64} />}
                <Label measured={t.measured} x={TGT.x + t.textX} cy={cy} labelClass={styles.targetLabel} subClass={styles.targetSub} />
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
