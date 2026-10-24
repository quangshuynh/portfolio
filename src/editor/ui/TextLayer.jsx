import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { normalizeTextOverlay } from '../model/overlays.mjs';
import { loadTextFonts } from '../text/fonts.mjs';
import { paintText, textBox } from '../text/textRender.mjs';

const MOVE_STEP = 0.002;
const MOVE_STEP_LARGE = 0.02;
const SNAP_DEGREES = 15;

/**
 * Text overlays over the preview: drawn on a canvas covering the stage with the export's
 * own drawing code (textRender.paintText), and, while the Text tool is on, a focusable box
 * per object with a resize and a rotate handle. Dragging a box moves only that text (the
 * photo does not pan); keyboard: arrows move (Shift: larger steps), Delete removes, Enter
 * edits the wording in the Text panel, Escape deselects.
 * :param box: the photo's displayed rectangle in stage pixels { x, y, width, height }
 * :param output: the photo's output size in pixels { width, height }
 * :param clip: fraction of the width (from the left) where the "before" side is shown, so no text
 */
export default function TextLayer({ overlays, box, output, stage, clip = 0, interactive, selectedId, onSelect, onPreview, onCommit, onApply, onEdit }) {
  const canvasRef = useRef(null);
  const [fonts, setFonts] = useState(false);
  const dragRef = useRef(null);
  const zoom = box.width / output.width;

  useEffect(() => {
    if (!overlays.length || fonts) return undefined;
    let alive = true;
    loadTextFonts().then(() => { if (alive) setFonts(true); }).catch(() => { if (alive) setFonts(true); });
    return () => { alive = false; };
  }, [overlays.length, fonts]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(stage.width * ratio));
    const height = Math.max(1, Math.round(stage.height * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!fonts || !overlays.length) return;
    context.save();
    const left = (box.x + box.width * clip) * ratio;
    context.beginPath();
    context.rect(left, 0, width - left, height);
    context.clip();
    const view = { scale: zoom * ratio, offsetX: box.x * ratio, offsetY: box.y * ratio, width: output.width, height: output.height };
    overlays.forEach((overlay) => paintText(context, overlay, view));
    context.restore();
  }, [overlays, box.x, box.y, box.width, box.height, output.width, output.height, stage.width, stage.height, clip, fonts, zoom]);

  // Boxes in stage pixels (layout in output pixels, scaled by the zoom).
  const boxes = useMemo(() => (interactive ? overlays.map((overlay) => {
    const { width, height } = textBox(overlay, output.width, output.height);
    return { overlay, width: width * zoom, height: height * zoom, x: box.x + overlay.x * box.width, y: box.y + overlay.y * box.height };
  }) : []), [interactive, overlays, output.width, output.height, zoom, box.x, box.y, box.width, box.height, fonts]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id, patch) => overlays.map((overlay) => (overlay.id === id ? normalizeTextOverlay({ ...overlay, ...patch }) : overlay));

  const start = (event, overlay, kind, centre) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(overlay.id);
    const angle = Math.atan2(event.clientY - centre.y, event.clientX - centre.x);
    const distance = Math.hypot(event.clientX - centre.x, event.clientY - centre.y) || 1;
    dragRef.current = { id: overlay.id, kind, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, overlay, centre, angle, distance, moved: false };
  };
  const move = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    const { overlay } = drag;
    let patch;
    if (drag.kind === 'move') {
      patch = { x: overlay.x + (event.clientX - drag.startX) / box.width, y: overlay.y + (event.clientY - drag.startY) / box.height };
    } else if (drag.kind === 'scale') {
      const distance = Math.hypot(event.clientX - drag.centre.x, event.clientY - drag.centre.y);
      patch = { scale: overlay.scale * (distance / drag.distance) };
    } else {
      const angle = Math.atan2(event.clientY - drag.centre.y, event.clientX - drag.centre.x);
      let rotation = overlay.rotation + ((angle - drag.angle) * 180) / Math.PI;
      if (event.shiftKey) rotation = Math.round(rotation / SNAP_DEGREES) * SNAP_DEGREES;
      patch = { rotation };
    }
    drag.moved = true;
    onPreview(update(drag.id, patch));
  };
  const end = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    // The release point counts too (some inputs send no move before it).
    if (event.type === 'pointerup' && (event.clientX !== drag.startX || event.clientY !== drag.startY)) move(event);
    event.stopPropagation();
    dragRef.current = null;
    if (drag.moved) onCommit();
  };
  // The stage's own coordinates of a client point, for handle centres.
  const toClient = (element, x, y) => {
    const rect = element.closest('.pe-stage-area').getBoundingClientRect();
    return { x: rect.left + x, y: rect.top + y };
  };
  const onKey = (event, overlay) => {
    const step = event.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      const [dx, dy] = moves[event.key];
      onApply(update(overlay.id, { x: overlay.x + dx, y: overlay.y + dy }), `text:${overlay.id}:move`);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      onApply(overlays.filter(({ id }) => id !== overlay.id));
      onSelect(null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onEdit(overlay.id);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      onSelect(null);
    }
  };

  return (
    <>
      <canvas ref={canvasRef} className="pe-text-canvas" aria-hidden="true" style={{ width: stage.width, height: stage.height }} />
      {interactive && (
        <div className="pe-textboxes" onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
          {boxes.map(({ overlay, width, height, x, y }) => {
            const selected = overlay.id === selectedId;
            const label = overlay.text.split('\n')[0].slice(0, 40) || 'Empty text';
            return (
              <div
                key={overlay.id}
                className="pe-textbox"
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`Text “${label}”. Arrow keys move it, Delete removes it, Enter edits the wording.`}
                data-selected={selected || undefined}
                style={{ left: x, top: y, width, height, transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)` }}
                onPointerDown={(event) => start(event, overlay, 'move', toClient(event.currentTarget, x, y))}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onDoubleClick={(event) => { event.stopPropagation(); onEdit(overlay.id); }}
                onKeyDown={(event) => onKey(event, overlay)}
                onFocus={() => onSelect(overlay.id)}
              >
                {selected && (
                  <>
                    <span
                      className="pe-textbox__handle pe-textbox__handle--scale"
                      aria-hidden="true"
                      onPointerDown={(event) => start(event, overlay, 'scale', toClient(event.currentTarget, x, y))}
                      onPointerMove={move}
                      onPointerUp={end}
                      onPointerCancel={end}
                    />
                    <span
                      className="pe-textbox__handle pe-textbox__handle--rotate"
                      aria-hidden="true"
                      onPointerDown={(event) => start(event, overlay, 'rotate', toClient(event.currentTarget, x, y))}
                      onPointerMove={move}
                      onPointerUp={end}
                      onPointerCancel={end}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
