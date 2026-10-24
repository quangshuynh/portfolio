import React, { useMemo, useRef } from 'react';
import { textBox } from '../text/textRender.mjs';
import { layerLabel, updateLayer } from '../model/layers.mjs';

const MOVE_STEP = 0.002;
const MOVE_STEP_LARGE = 0.02;
const SNAP_DEGREES = 15;

/**
 * Boxes over the preview for the visible image and text layers while the layer tool is on:
 * drag a box to move that layer (the photo does not pan), the corner handle resizes (image
 * layers keep their proportions unless Shift is held or Free resize is on), the round handle
 * rotates (Shift: 15° steps). Keyboard on a focused box: arrows move (Shift: larger steps),
 * Delete removes, Enter edits a text's wording, Escape deselects. Locked layers can be
 * selected but not moved. Geometry is computed from the layers' canvas-relative fields.
 * :param box: the photo's displayed rectangle in stage pixels { x, y, width, height }
 * :param output: the canvas (output frame) size in pixels { width, height }
 */
export default function LayerHandles({ layers, box, output, selectedId, freeResize = false, onSelect, onPreview, onCommit, onApply, onEdit }) {
  const dragRef = useRef(null);
  const zoom = box.width / output.width;
  const short = Math.min(output.width, output.height);

  // Boxes in stage pixels, bottom layer first so the top one receives the pointer.
  const boxes = useMemo(() => layers.filter((layer) => layer.visible && (layer.type === 'image' || layer.type === 'text')).map((layer) => {
    const size = layer.type === 'text' ? textBox(layer, output.width, output.height) : { width: layer.width * short, height: layer.height * short };
    return { layer, width: size.width * zoom, height: size.height * zoom, x: box.x + layer.x * box.width, y: box.y + layer.y * box.height };
  }), [layers, output.width, output.height, short, zoom, box.x, box.y, box.width, box.height]);

  const start = (event, layer, kind, centre, size) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* a synthetic or already released pointer */ }
    onSelect(layer.id);
    if (layer.locked) return;
    const angle = Math.atan2(event.clientY - centre.y, event.clientX - centre.x);
    const distance = Math.hypot(event.clientX - centre.x, event.clientY - centre.y) || 1;
    dragRef.current = { id: layer.id, kind, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, layer, centre, angle, distance, size, moved: false };
  };
  const move = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    const { layer } = drag;
    let patch;
    if (drag.kind === 'move') {
      patch = { x: layer.x + (event.clientX - drag.startX) / box.width, y: layer.y + (event.clientY - drag.startY) / box.height };
    } else if (drag.kind === 'scale') {
      const ratio = Math.hypot(event.clientX - drag.centre.x, event.clientY - drag.centre.y) / drag.distance;
      if (layer.type === 'text') {
        patch = { scale: layer.scale * ratio };
      } else if (freeResize || event.shiftKey) {
        // The pointer in the layer's own axes gives each half-extent.
        const radians = (layer.rotation * Math.PI) / 180;
        const dx = event.clientX - drag.centre.x;
        const dy = event.clientY - drag.centre.y;
        const lx = Math.abs(dx * Math.cos(radians) + dy * Math.sin(radians));
        const ly = Math.abs(-dx * Math.sin(radians) + dy * Math.cos(radians));
        patch = { width: (2 * lx) / (short * zoom), height: (2 * ly) / (short * zoom) };
      } else {
        patch = { width: layer.width * ratio, height: layer.height * ratio };
      }
    } else {
      const angle = Math.atan2(event.clientY - drag.centre.y, event.clientX - drag.centre.x);
      let rotation = layer.rotation + ((angle - drag.angle) * 180) / Math.PI;
      if (event.shiftKey) rotation = Math.round(rotation / SNAP_DEGREES) * SNAP_DEGREES;
      patch = { rotation };
    }
    drag.moved = true;
    onPreview(updateLayer(layers, drag.id, patch));
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
  const toClient = (element, x, y) => {
    const rect = element.closest('.pe-stage-area').getBoundingClientRect();
    return { x: rect.left + x, y: rect.top + y };
  };
  const onKey = (event, layer) => {
    const step = event.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      if (layer.locked) return;
      const [dx, dy] = moves[event.key];
      onApply(updateLayer(layers, layer.id, { x: layer.x + dx, y: layer.y + dy }), `layer:${layer.id}:move`);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !layer.locked) {
      event.preventDefault();
      event.stopPropagation();
      onApply(layers.filter(({ id }) => id !== layer.id));
      onSelect(null);
    } else if (event.key === 'Enter' && layer.type === 'text') {
      event.preventDefault();
      onEdit(layer.id);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      onSelect(null);
    }
  };

  return (
    <div className="pe-textboxes" onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
      {boxes.map(({ layer, width, height, x, y }) => {
        const selected = layer.id === selectedId;
        const label = layerLabel(layer);
        const kind = layer.type === 'text' ? 'Text' : 'Image layer';
        const help = layer.locked ? 'Locked.' : `Arrow keys move it, Delete removes it${layer.type === 'text' ? ', Enter edits the wording' : ''}.`;
        return (
          <div
            key={layer.id}
            className="pe-textbox"
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${kind} “${label}”. ${help}`}
            data-selected={selected || undefined}
            data-kind={layer.type}
            data-locked={layer.locked || undefined}
            style={{ left: x, top: y, width, height, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}
            onPointerDown={(event) => start(event, layer, 'move', toClient(event.currentTarget, x, y))}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={(event) => { event.stopPropagation(); if (layer.type === 'text') onEdit(layer.id); }}
            onKeyDown={(event) => onKey(event, layer)}
            onFocus={() => onSelect(layer.id)}
          >
            {selected && !layer.locked && (
              <>
                <span
                  className="pe-textbox__handle pe-textbox__handle--scale"
                  aria-hidden="true"
                  onPointerDown={(event) => start(event, layer, 'scale', toClient(event.currentTarget, x, y))}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                />
                <span
                  className="pe-textbox__handle pe-textbox__handle--rotate"
                  aria-hidden="true"
                  onPointerDown={(event) => start(event, layer, 'rotate', toClient(event.currentTarget, x, y))}
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
  );
}
