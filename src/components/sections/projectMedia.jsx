import React, { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FaExternalLinkAlt, FaPlay } from 'react-icons/fa';
import { HomeImageTrigger } from '../utilities/homeLightbox';

// Display-sized WebP derivatives written by `npm run prepare:images`: every
// project logo plus the screenshots of private repositories.
const optimizedImages = import.meta.glob('../../assets/optimized/*.webp', { eager: true, import: 'default' });

/**
 * resolves a bundled derivative by file name
 * :param name: file name without extension, e.g. ordixa-logo
 * :returns: bundled asset URL, or undefined when no derivative exists
 */
export function optimizedImage(name) {
  return optimizedImages[`../../assets/optimized/${name}.webp`];
}

/**
 * resolves a project image entry to a URL
 * :param image: screenshot entry with either a pinned `src` or a `local` derivative name
 * :returns: image URL
 */
export function imageSource(image) {
  return image.src ?? optimizedImage(image.local);
}

/**
 * builds the lightbox gallery for a project's screenshots
 * :param project: project entry
 * :returns: gallery entries for the lightbox
 */
export function lightboxGallery(project) {
  return project.screenshots.map((shot) => ({ src: imageSource(shot), alt: shot.alt, caption: shot.caption }));
}

/**
 * renders one screenshot as a lightbox trigger
 * :param project: project entry
 * :param index: screenshot index
 * :param imageClassName: class for the <img>
 * :returns: screenshot markup
 */
export function ProjectScreenshot({ project, index, imageClassName }) {
  const shot = project.screenshots[index];
  const multiple = project.screenshots.length > 1;
  return (
    <HomeImageTrigger
      // A fresh trigger per image clears any failure state from the previous one.
      key={imageSource(shot)}
      src={imageSource(shot)}
      width={shot.width}
      height={shot.height}
      imageClassName={imageClassName}
      alt={shot.alt}
      caption={shot.caption}
      gallery={multiple ? lightboxGallery(project) : undefined}
      galleryIndex={multiple ? index : undefined}
    />
  );
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * formats a whole number of seconds as m:ss
 * :param seconds: duration in seconds
 * :returns: e.g. 0:23
 */
export const formatDuration = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * renders a project video behind its poster: only the poster is fetched until
 * the visitor presses play, so the page never downloads video it does not
 * show. Sound only ever starts from that press; with reduced motion the player
 * loads paused instead. If the browser cannot play the file, a link to the
 * release page takes its place.
 * :param project: project entry with a `video`
 * :returns: video figure markup
 */
export function ProjectVideo({ project }) {
  const { video } = project;
  const [stage, setStage] = useState('poster');
  const player = useRef(null);
  const label = `${video.title} (${formatDuration(video.duration)}, with sound)`;

  const start = () => {
    // Mount the player inside the click so play() keeps the user gesture
    // (Safari drops it across an effect), and move focus off the vanished button.
    flushSync(() => setStage('player'));
    player.current?.focus({ preventScroll: true });
    if (!prefersReducedMotion()) player.current?.play()?.catch(() => {});
  };

  return (
    <figure className="project-video">
      <div className="project-video__frame">
        {stage === 'poster' && (
          <button type="button" className="project-video__poster" onClick={start} aria-label={`Play ${label}`}>
            <img src={video.poster} width={video.width} height={video.height} alt="" loading="lazy" decoding="async" />
            <span className="project-video__play" aria-hidden="true">
              <FaPlay />
              <span>Play <span className="mono">{formatDuration(video.duration)}</span></span>
            </span>
          </button>
        )}
        {stage === 'player' && (
          <video
            ref={player}
            src={video.src}
            poster={video.poster}
            width={video.width}
            height={video.height}
            controls
            // Focusable everywhere (not only where the browser's controls make it so),
            // so focus can land here when the play button disappears.
            tabIndex={0}
            playsInline
            preload="metadata"
            aria-label={video.title}
            onError={() => setStage('failed')}
          >
            <a href={video.page} target="_blank" rel="noreferrer">Watch {video.title} on GitHub</a>
          </video>
        )}
        {stage === 'failed' && (
          <div className="project-video__fallback" role="status">
            <img src={video.poster} width={video.width} height={video.height} alt="" loading="lazy" decoding="async" />
            <p>
              The video cannot play here.{' '}
              <a href={video.page} target="_blank" rel="noreferrer">Watch it on GitHub <FaExternalLinkAlt aria-hidden="true" /></a>
            </p>
          </div>
        )}
      </div>
      <figcaption className="project-video__caption">
        <span>{video.caption}</span>
        <a className="text-link" href={video.page} target="_blank" rel="noreferrer" aria-label={`Open ${video.title} on GitHub`}>
          GitHub release <FaExternalLinkAlt aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}

/**
 * renders a project's video, logo, and screenshot tabs; only the selected
 * slide is in the DOM, so screenshots and video are fetched when chosen
 * :param project: project entry with a video, or a logo and screenshots
 * :returns: gallery markup
 */
export function ProjectGallery({ project }) {
  const { video, logo, screenshots = [] } = project;
  const [slide, setSlide] = useState(video ? 'video' : 'logo');
  const shotClass = `project-result-image${project.tallScreenshots ? ' vertical-project-shot' : ''}`;
  const tabs = [
    ...(video ? [{ id: 'video', label: 'Video' }] : []),
    ...(logo ? [{ id: 'logo', label: 'Logo' }] : []),
    ...screenshots.map((shot, index) => ({ id: index, label: shot.label })),
  ];

  return (
    <div className="project-visual gallery">
      <div className={`gallery-stage${slide === 'video' ? ' gallery-stage--video' : ''}`}>
        {slide === 'video' && <ProjectVideo project={project} />}
        {slide === 'logo' && (
          <img
            src={optimizedImage(logo.file)}
            width={logo.width}
            height={logo.height}
            alt={logo.alt}
            loading="lazy"
            decoding="async"
          />
        )}
        {typeof slide === 'number' && (
          <ProjectScreenshot project={project} index={slide} imageClassName={shotClass} />
        )}
      </div>
      <div className="gallery-controls" role="group" aria-label={`${project.name} gallery`}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" aria-pressed={slide === tab.id} onClick={() => setSlide(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * selects the visual for a featured project: a gallery when it has a video, or
 * a logo and screenshots; otherwise its single production screenshot or logo
 * :param project: project entry
 * :returns: visual markup
 */
export function ProjectVisual({ project }) {
  if (project.video || (project.logo && project.screenshots?.length)) return <ProjectGallery project={project} />;
  if (project.screenshots?.length) {
    return (
      <div className="project-visual production-site-visual">
        <ProjectScreenshot project={project} index={0} />
      </div>
    );
  }
  if (project.logo) {
    return (
      <div className="project-visual gallery">
        <div className="gallery-stage">
          <img src={optimizedImage(project.logo.file)} width={project.logo.width} height={project.logo.height} alt={project.logo.alt} loading="lazy" decoding="async" />
        </div>
      </div>
    );
  }
  return null;
}
