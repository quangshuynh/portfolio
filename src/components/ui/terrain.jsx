import React from 'react';

/** Park–Miller PRNG so decorative terrain is identical on every render. */
function seeded(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const round = (value) => Math.round(value * 10) / 10;

/** Closed Catmull-Rom spline through points, expressed as cubic Béziers. */
function closedSpline(points) {
  const count = points.length;
  let path = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let index = 0; index < count; index += 1) {
    const p0 = points[(index - 1 + count) % count];
    const p1 = points[index];
    const p2 = points[(index + 1) % count];
    const p3 = points[(index + 2) % count];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    path += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${path}Z`;
}

/** Irregular nested rings that read as elevation contours around a summit. */
export function contourRings({ cx, cy, rings, baseRadius, step, seed, stretch = 1.3 }) {
  const random = seeded(seed);
  const harmonics = Array.from({ length: 4 }, (_, index) => ({
    k: index + 2,
    amp: (0.06 + random() * 0.12) / (index + 1),
    phase: random() * Math.PI * 2,
  }));
  return Array.from({ length: rings }, (_, ring) => {
    const radius = baseRadius + ring * step;
    const points = Array.from({ length: 44 }, (_, index) => {
      const angle = (index / 44) * Math.PI * 2;
      const wobble = harmonics.reduce(
        (total, { k, amp, phase }) => total + amp * Math.sin(k * angle + phase + ring * 0.12),
        1,
      );
      return [cx + Math.cos(angle) * radius * wobble * stretch, cy + Math.sin(angle) * radius * wobble];
    });
    return closedSpline(points);
  });
}

const topoSets = {
  hero: [
    ...contourRings({ cx: 780, cy: 330, rings: 22, baseRadius: 18, step: 26, seed: 11 }),
    ...contourRings({ cx: 140, cy: 860, rings: 12, baseRadius: 30, step: 28, seed: 29 }),
  ],
  quiet: contourRings({ cx: 820, cy: 520, rings: 18, baseRadius: 26, step: 30, seed: 7 }),
};

/**
 * Decorative topographic contours. Every fifth line is an index contour,
 * drawn a little heavier as on a real survey map.
 */
export function TopoField({ variant = 'hero', className = '' }) {
  const paths = topoSets[variant] ?? topoSets.hero;
  return (
    <svg className={`topo-field${className ? ` ${className}` : ''}`} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g className="topo-field__drift">
        {paths.map((d, index) => (
          <path key={index} d={d} className={index % 5 === 4 ? 'topo-field__index' : undefined} />
        ))}
      </g>
    </svg>
  );
}

function ridgePath({ seed, base, amplitude, roughness, width = 1600, height = 320, points = 34, trees = false }) {
  const random = seeded(seed);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  let path = `M0 ${height}`;
  for (let index = 0; index <= points; index += 1) {
    const x = (index / points) * width;
    const t = index / points;
    const y = base
      - Math.sin(t * Math.PI * 1.6 + phaseA) * amplitude
      - Math.sin(t * Math.PI * 4.3 + phaseB) * amplitude * 0.35
      - (random() - 0.5) * roughness;
    path += ` L${round(x)} ${round(y)}`;
    if (trees && index < points) {
      // A ragged conifer line: short spikes between ridge samples.
      const spikes = 5;
      for (let spike = 1; spike <= spikes; spike += 1) {
        const sx = x + (spike / (spikes + 1)) * (width / points);
        const tip = y - 6 - random() * 16;
        path += ` L${round(sx - 3)} ${round(y - random() * 3)} L${round(sx)} ${round(tip)} L${round(sx + 3)} ${round(y - random() * 3)}`;
      }
    }
  }
  return `${path} L${width} ${height} Z`;
}

const ridgeLayers = [
  ridgePath({ seed: 3, base: 150, amplitude: 52, roughness: 22 }),
  ridgePath({ seed: 17, base: 210, amplitude: 34, roughness: 16 }),
  ridgePath({ seed: 41, base: 262, amplitude: 18, roughness: 8, points: 60, trees: true }),
];

/** Layered ridge silhouettes; layers parallax independently where supported. */
export function Ridgeline({ className = '' }) {
  return (
    <svg className={`ridgeline${className ? ` ${className}` : ''}`} viewBox="0 0 1600 320" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {ridgeLayers.map((d, index) => <path key={index} d={d} className={`ridgeline__layer ridgeline__layer--${index + 1}`} />)}
    </svg>
  );
}
