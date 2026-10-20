import React from 'react';
import styles from './styles.module.css';

// SVG text does not wrap, so labels are broken into lines here. Widths are
// estimated from rough sans-serif glyph widths (in em) instead of measured in the
// browser, so the server render and the client render always agree.
const NARROW = new Set("il.,:;'|!()[]tfjrI1 ");
const WIDE = new Set('mwMW@%');

export function textWidth(text, fontSize, bold) {
  let em = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.3;
    else if (WIDE.has(ch)) em += 0.86;
    else if (ch >= 'A' && ch <= 'Z') em += 0.68;
    else if (ch >= '0' && ch <= '9') em += 0.58;
    else em += 0.55;
  }
  return em * fontSize * (bold ? 1.06 : 1);
}

// Break points: spaces are dropped, a slash stays at the end of its line.
function tokenize(text) {
  return text
    .split(/\s+/)
    .flatMap((word) => word.replace(/\//g, '/\n').split('\n'))
    .filter(Boolean);
}

function wrap(text, maxWidth, fontSize, bold) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const token of tokenize(paragraph)) {
      const joiner = line && !line.endsWith('/') ? ' ' : '';
      const candidate = line + joiner + token;
      if (line && textWidth(candidate, fontSize, bold) > maxWidth) {
        lines.push(line);
        line = token;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Wraps at the preferred size and shrinks the font, step by step, until the
// text fits in maxLines lines of maxWidth (or the minimum size is reached).
export function fitText(text, {maxWidth, fontSize, minFontSize = fontSize, maxLines = 2, bold = false}) {
  if (text === undefined || text === null || text === '') return null;
  let size = fontSize;
  for (;;) {
    const lines = wrap(text, maxWidth, size, bold);
    const fits = lines.length <= maxLines && lines.every((l) => textWidth(l, size, bold) <= maxWidth);
    if (fits || size - 2 < minFontSize) {
      const lineHeight = Math.round(size * 1.2);
      return {lines, fontSize: size, lineHeight, height: lines.length * lineHeight};
    }
    size -= 2;
  }
}

// A bold label with an optional muted line below, measured as one block.
export function measureLabel(label, sub, {maxWidth, labelSize, subSize, maxLines = 2, gap = 6}) {
  const main = fitText(label, {maxWidth, fontSize: labelSize, minFontSize: labelSize - 6, maxLines, bold: true});
  const second = fitText(sub, {maxWidth, fontSize: subSize, minFontSize: subSize - 4, maxLines});
  const height = (main?.height ?? 0) + (second ? gap + second.height : 0);
  return {main, second, gap, height};
}

export function TextLines({fit, x, y, className, anchor = 'start'}) {
  if (!fit) return null;
  return (
    <text className={className} x={x} y={y} textAnchor={anchor} style={{fontSize: fit.fontSize}}>
      {fit.lines.map((line, i) => (
        <tspan key={i} x={x} y={y + i * fit.lineHeight + fit.lineHeight / 2}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

// Draws a measureLabel() block vertically centered on cy.
export function Label({measured, x, cy, labelClass, subClass, anchor}) {
  const {main, second, gap, height} = measured;
  const top = cy - height / 2;
  return (
    <>
      <TextLines fit={main} x={x} y={top} className={labelClass} anchor={anchor} />
      <TextLines fit={second} x={x} y={top + (main?.height ?? 0) + gap} className={subClass} anchor={anchor} />
    </>
  );
}

export function Icon({name, x, y, size}) {
  const body = icons[name];
  if (!body) return null;
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {body}
    </svg>
  );
}

const icons = {
  user: (
    <>
      <circle className={styles.i1} cx="12" cy="7" r="4.5" />
      <path className={styles.i1} d="M3 21.5c0-4.6 4-7.5 9-7.5s9 2.9 9 7.5z" />
    </>
  ),
  server: (
    <>
      <rect className={styles.i1} x="3" y="3" width="18" height="8" rx="2" />
      <rect className={styles.i1} x="3" y="13" width="18" height="8" rx="2" />
      <circle className={styles.i3} cx="7" cy="7" r="1.3" />
      <circle className={styles.i3} cx="7" cy="17" r="1.3" />
    </>
  ),
  layers: (
    <>
      <path className={styles.i3} d="M12 10l10 5-10 5-10-5z" />
      <path className={styles.i2} d="M12 6l10 5-10 5-10-5z" />
      <path className={styles.i1} d="M12 2l10 5-10 5-10-5z" />
    </>
  ),
  database: (
    <>
      <path className={styles.i1} d="M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3v14c0 1.7-3.6 3-8 3s-8-1.3-8-3z" />
      <path className={styles.iCut} d="M4 5.5c0 1.7 3.6 3 8 3s8-1.3 8-3M4 11.5c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  chip: (
    <>
      <path className={styles.iPins} d="M9 2v4M12 2v4M15 2v4M9 18v4M12 18v4M15 18v4M2 9h4M2 12h4M2 15h4M18 9h4M18 12h4M18 15h4" />
      <rect className={styles.i1} x="5" y="5" width="14" height="14" rx="2.5" />
      <rect className={styles.i3} x="8" y="8" width="8" height="8" rx="1.5" />
    </>
  ),
  log: (
    <>
      <rect className={styles.i1} x="4" y="2" width="16" height="20" rx="2.5" />
      <path className={styles.iCut} d="M8 7h8M8 11h8M8 15h5" />
    </>
  ),
  lock: (
    <>
      <path className={styles.iPins} d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" />
      <rect className={styles.i1} x="4" y="10" width="16" height="12" rx="2.5" />
      <circle className={styles.i3} cx="12" cy="16" r="1.8" />
    </>
  ),
};

// Gradient for the dark "hub" boxes and the arrowhead, scoped by a per-instance id.
export function Defs({id}) {
  return (
    <defs>
      <linearGradient id={`${id}-hub`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className={styles.hubStopTop} />
        <stop offset="1" className={styles.hubStopBottom} />
      </linearGradient>
      <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="18" markerHeight="18" markerUnits="userSpaceOnUse" orient="auto">
        <path className={styles.arrowHead} d="M0,0 L10,5 L0,10 z" />
      </marker>
    </defs>
  );
}

export function useDiagramId() {
  return React.useId().replace(/:/g, '');
}

export function normalize(item) {
  return typeof item === 'string' ? {label: item} : item;
}

export function listText(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
