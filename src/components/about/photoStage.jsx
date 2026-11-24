import React, { useRef } from 'react';
import { FaChevronLeft, FaChevronRight, FaSearchPlus } from 'react-icons/fa';

const SWIPE_DISTANCE = 40;

/** One photo at a time, uncropped, with the rest as a strip. The parent owns `index` so the viewer can share it. */
export default function PhotoStage({ items, index, label, onSelect, onStep, onOpen }) {
  const touchStart = useRef(null);
  const photo = items[index];

  const handleTouchStart = ({ touches }) => {
    touchStart.current = touches.length === 1 ? { x: touches[0].clientX, y: touches[0].clientY } : null;
  };

  const handleTouchEnd = ({ changedTouches }) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const x = changedTouches[0].clientX - start.x;
    const y = changedTouches[0].clientY - start.y;
    if (Math.abs(x) >= SWIPE_DISTANCE && Math.abs(x) > Math.abs(y) * 1.5) onStep(x < 0 ? 1 : -1);
  };

  return (
    <div className="photo-stage" role="group" aria-label={label}>
      <div
        className="photo-stage-mat"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => { touchStart.current = null; }}
      >
        <button className="photo-stage-photo" type="button" aria-label={`Open image: ${photo.caption}`} aria-haspopup="dialog" onClick={(event) => onOpen(event.currentTarget)}>
          <img key={photo.src} src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} draggable="false" />
          <span className="photography-gallery-zoom-hint" aria-hidden="true"><FaSearchPlus /></span>
        </button>
      </div>

      <div className="photo-stage-side">
        <div className="photo-stage-text" aria-live="polite">
          <p className="photo-stage-caption">{photo.caption}</p>
          <p className="photo-stage-count">{index + 1} of {items.length}</p>
        </div>
        <div className="photo-stage-controls">
          <button type="button" aria-label="Previous photo" onClick={() => onStep(-1)}><FaChevronLeft aria-hidden="true" /></button>
          <button type="button" aria-label="Next photo" onClick={() => onStep(1)}><FaChevronRight aria-hidden="true" /></button>
        </div>
      </div>

      <ul className="photo-stage-strip" style={{ '--count': items.length }}>
        {items.map(({ src, width, height, caption, position }, itemIndex) => (
          <li key={src}>
            <button type="button" aria-label={`Show photo ${itemIndex + 1} of ${items.length}: ${caption}`} aria-current={itemIndex === index ? 'true' : undefined} onClick={() => onSelect(itemIndex)}>
              <img src={src} width={width} height={height} alt="" draggable="false" style={position ? { objectPosition: position } : undefined} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
