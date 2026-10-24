import React, { useRef, useState } from 'react';
import { CROP_HANDLES, cropKeyStep, dragCrop, keystoneQuad, quadIsUsable } from '../pipeline/geometry.mjs';

const HANDLE_LABELS = {
  nw: 'top-left corner', n: 'top edge', ne: 'top-right corner', e: 'right edge',
  se: 'bottom-right corner', s: 'bottom edge', sw: 'bottom-left corner', w: 'left edge',
};
const CORNER_LABELS = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const FULL = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

const round = (value) => Math.round(value * 100) / 100;

/**
 * Crop & Transform on the image: the crop box (crop mode) or the four perspective corners
 * (corners mode) over the transformed frame, in normalised frame coordinates.
 * Pointer and touch drags preview and record one undo step on release; arrow keys move
 * (Shift: larger steps) the focused box, edge, corner or perspective point; Enter applies,
 * Escape cancels.
 * :param props: mode ('crop' | 'corners'), geometry, content (normalised quad the photo
 *   covers in the frame), ratio (normalised width / height, or null), output ({ width,
 *   height } px the crop will have, for the readout), box ({ x, y, width, height } CSS px of
 *   the frame in the stage), guide (fine grid), onPreview(next), onCommit(), onSet(next,
 *   coalesceKey), onApply(), onCancel()
 */
export default function CropOverlay({ mode, geometry, content, ratio, output, box, guide, onPreview, onCommit, onSet, onApply, onCancel }) {
  const dragRef = useRef(null);
  const [active, setActive] = useState(null);
  const rect = geometry.crop ?? FULL;
  const quad = geometry.quad ?? keystoneQuad(geometry.perspective.vertical, geometry.perspective.horizontal);
  const bounds = geometry.constrain ? content : null;

  const cropAfter = (handle, dx, dy, start = rect) => dragCrop(start, handle, dx, dy, { ratio, content: bounds });
  const quadAfter = (index, dx, dy, start = quad) => {
    const next = start.map((point, i) => (i === index ? [Math.min(1, Math.max(0, point[0] + dx)), Math.min(1, Math.max(0, point[1] + dy))] : point));
    return quadIsUsable(next) ? next : null;
  };

  const startDrag = (event, target) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { target, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect, quad, moved: false };
    setActive(target);
  };
  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.x) / box.width;
    const dy = (event.clientY - drag.y) / box.height;
    drag.moved = true;
    if (typeof drag.target === 'number') {
      const next = quadAfter(drag.target, dx, dy, drag.quad);
      if (next) onPreview({ ...geometry, quad: next });
    } else {
      onPreview({ ...geometry, crop: cropAfter(drag.target, dx, dy, drag.rect) });
    }
  };
  const endDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setActive(null);
    if (drag.moved) onCommit();
  };

  const onKeyDown = (event, target) => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onApply(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); return; }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    event.stopPropagation();
    const step = cropKeyStep(event.shiftKey);
    const [dx, dy] = [arrow[0] * step, arrow[1] * step];
    if (typeof target === 'number') {
      const next = quadAfter(target, dx, dy);
      if (next) onSet({ ...geometry, quad: next }, `corner-${target}`);
    } else {
      onSet({ ...geometry, crop: cropAfter(target, dx, dy) }, `crop-${target}`);
    }
  };

  const px = (value, axis) => value * (axis === 'x' ? box.width : box.height);
  const contentPath = content.map(([x, y], i) => `${i ? 'L' : 'M'}${round(px(x, 'x'))} ${round(px(y, 'y'))}`).join(' ');
  const coversFrame = content.every(([x, y], i) => [[0, 0], [1, 0], [1, 1], [0, 1]][i].every((v, k) => Math.abs([x, y][k] - v) < 1e-6));

  if (mode === 'corners') {
    const points = quad.map(([x, y]) => [px(x, 'x'), px(y, 'y')]);
    return (
      <div className="pe-crop" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} data-mode="corners">
        <svg className="pe-crop__svg" width={box.width} height={box.height} aria-hidden="true">
          <path className="pe-crop__quad" d={`${points.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join(' ')} Z`} />
          {[1, 2].map((k) => (
            <g key={k} className="pe-crop__grid">
              <line x1={points[0][0] + ((points[3][0] - points[0][0]) * k) / 3} y1={points[0][1] + ((points[3][1] - points[0][1]) * k) / 3} x2={points[1][0] + ((points[2][0] - points[1][0]) * k) / 3} y2={points[1][1] + ((points[2][1] - points[1][1]) * k) / 3} />
              <line x1={points[0][0] + ((points[1][0] - points[0][0]) * k) / 3} y1={points[0][1] + ((points[1][1] - points[0][1]) * k) / 3} x2={points[3][0] + ((points[2][0] - points[3][0]) * k) / 3} y2={points[3][1] + ((points[2][1] - points[3][1]) * k) / 3} />
            </g>
          ))}
        </svg>
        <p className="visually-hidden" id="pe-corners-help">Place the four points on lines that should be a rectangle (for example a building's edges). Arrow keys move the focused point; Enter applies, Escape cancels.</p>
        {points.map(([x, y], index) => (
          <span
            key={CORNER_LABELS[index]}
            className="pe-crop__point"
            role="slider"
            tabIndex={0}
            aria-label={`${CORNER_LABELS[index]} perspective point`}
            aria-describedby="pe-corners-help"
            aria-valuetext={`${Math.round(quad[index][0] * 100)}% across, ${Math.round(quad[index][1] * 100)}% down`}
            aria-valuenow={Math.round(quad[index][0] * 100)}
            data-active={active === index || undefined}
            style={{ left: x, top: y }}
            onPointerDown={(event) => startDrag(event, index)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        ))}
      </div>
    );
  }

  const left = px(rect.x, 'x');
  const top = px(rect.y, 'y');
  const width = px(rect.width, 'x');
  const height = px(rect.height, 'y');
  const pixels = output;
  return (
    <div className="pe-crop" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} data-mode="crop">
      <svg className="pe-crop__svg" width={box.width} height={box.height} aria-hidden="true">
        <path className="pe-crop__shade" fillRule="evenodd" d={`M0 0H${round(box.width)}V${round(box.height)}H0Z M${round(left)} ${round(top)}H${round(left + width)}V${round(top + height)}H${round(left)}Z`} />
        {!coversFrame && <path className="pe-crop__content" d={`${contentPath} Z`} />}
      </svg>
      <div
        className="pe-crop__box"
        role="slider"
        tabIndex={0}
        aria-label="Crop area"
        aria-describedby="pe-crop-help"
        aria-valuetext={`${pixels.width} × ${pixels.height} px at ${Math.round(rect.x * 100)}%, ${Math.round(rect.y * 100)}%`}
        aria-valuenow={Math.round(rect.x * 100)}
        data-active={active === 'move' || undefined}
        data-guide={guide || undefined}
        style={{ left, top, width, height }}
        onPointerDown={(event) => startDrag(event, 'move')}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => onKeyDown(event, 'move')}
      >
        <span className="pe-crop__thirds" aria-hidden="true" />
        <span className="pe-crop__size mono" aria-hidden="true">{pixels.width} × {pixels.height}</span>
        {CROP_HANDLES.filter((handle) => handle !== 'move').map((handle) => (
          <span
            key={handle}
            className="pe-crop__handle"
            data-handle={handle}
            role="slider"
            tabIndex={0}
            aria-label={`Crop ${HANDLE_LABELS[handle]}`}
            aria-describedby="pe-crop-help"
            aria-valuetext={`${pixels.width} × ${pixels.height} px`}
            aria-valuenow={pixels.width}
            data-active={active === handle || undefined}
            onPointerDown={(event) => startDrag(event, handle)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => onKeyDown(event, handle)}
          />
        ))}
      </div>
      <p className="visually-hidden" id="pe-crop-help">Drag the box or its edges. Arrow keys move the focused box or resize from the focused edge or corner; Shift for larger steps. Enter applies, Escape cancels.</p>
    </div>
  );
}
