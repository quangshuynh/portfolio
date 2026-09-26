import React, { useEffect, useId, useRef, useState } from 'react';
import { FaSpotify } from 'react-icons/fa';
import { getFreshSpotifyTracksCache, subscribeSpotifyTracks } from '../../util/spotify';

const RING_TEXT = 'On repeat · recently played · Spotify · ';

function latestTrack(tracks) {
  if (!tracks?.length) return null;
  return [...tracks].sort((a, b) => (Date.parse(b.playedAt) || 0) - (Date.parse(a.playedAt) || 0))[0];
}

/**
 * A slowly turning record label set in Circular, Spotify's typeface. It never
 * fetches on its own: once listening data is cached, the latest cover sits in
 * the label. Rotation pauses offscreen and is removed for reduced motion.
 */
export default function SpotifyDisc({ href, onClick, className = '', label = 'Recently played on Spotify' }) {
  const root = useRef(null);
  const ringId = `spotify-disc-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [track, setTrack] = useState(() => latestTrack(getFreshSpotifyTracksCache()));
  const [visible, setVisible] = useState(true);

  useEffect(() => subscribeSpotifyTracks((tracks) => setTrack(latestTrack(tracks))), []);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const content = (
    <>
      <svg className="spotify-disc__svg" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <defs>
          <path id={ringId} d="M100 100 m-79 0 a79 79 0 1 1 158 0 a79 79 0 1 1 -158 0" />
        </defs>
        <circle cx="100" cy="100" r="92" className="spotify-disc__bezel" />
        <g className="spotify-disc__record">
          <circle cx="100" cy="100" r="62" className="spotify-disc__vinyl" />
          {[56, 50, 44].map((r) => <circle key={r} cx="100" cy="100" r={r} className="spotify-disc__groove" />)}
        </g>
        <g className="spotify-disc__ring">
          <text className="spotify-disc__text">
            <textPath href={`#${ringId}`} textLength="492" lengthAdjust="spacing">{RING_TEXT}</textPath>
          </text>
        </g>
        {Array.from({ length: 24 }, (_, index) => (
          <line key={index} x1="100" y1="4" x2="100" y2={index % 6 === 0 ? 11 : 8} className="spotify-disc__tick" transform={`rotate(${index * 15} 100 100)`} />
        ))}
      </svg>
      <span className="spotify-disc__label">
        {track?.image
          ? <img src={track.image} alt="" loading="lazy" decoding="async" />
          : <FaSpotify aria-hidden="true" />}
      </span>
    </>
  );

  const shared = {
    ref: root,
    className: `spotify-disc${className ? ` ${className}` : ''}`,
    'data-paused': visible ? undefined : 'true',
    title: track ? `Latest: ${track.name} — ${track.artist}` : label,
  };

  if (href) return <a {...shared} href={href} aria-label={label}>{content}</a>;
  return <button {...shared} type="button" onClick={onClick} aria-label={label} aria-haspopup="dialog">{content}</button>;
}
