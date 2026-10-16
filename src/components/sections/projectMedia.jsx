import React, { useState } from 'react';
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

/**
 * renders a logo slide followed by screenshot tabs; only the selected image is
 * in the DOM, so screenshots are fetched when their tab is chosen
 * :param project: project entry with a logo and screenshots
 * :returns: gallery markup
 */
export function ProjectGallery({ project }) {
  const [slide, setSlide] = useState('logo');
  const { logo, screenshots } = project;
  const shotClass = `project-result-image${project.tallScreenshots ? ' vertical-project-shot' : ''}`;
  const tabs = [{ id: 'logo', label: 'Logo' }, ...screenshots.map((shot, index) => ({ id: index, label: shot.label }))];

  return (
    <div className="project-visual gallery">
      <div className="gallery-stage">
        {slide === 'logo' ? (
          <img
            src={optimizedImage(logo.file)}
            width={logo.width}
            height={logo.height}
            alt={logo.alt}
            loading="lazy"
            decoding="async"
          />
        ) : (
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
 * selects the visual for a featured project: a gallery when it has a logo and
 * screenshots, otherwise its single production screenshot
 * :param project: project entry
 * :returns: visual markup
 */
export function ProjectVisual({ project }) {
  if (project.logo && project.screenshots?.length) return <ProjectGallery project={project} />;
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
