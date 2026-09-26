import React from 'react';
import ritLogo from '../../assets/logos/rit-logo.png';
import { aboutHref, photographyPageHref } from './siteNav';
import hikingThumb from '../../assets/about/thumbs/hiking-overlook-720.webp';
import subaruThumb from '../../assets/about/thumbs/subaru-waterfront-720.webp';
import cameraThumb from '../../assets/about/thumbs/camera-sunset-720.webp';

const fieldNotes = [
  { src: subaruThumb, width: 720, height: 960, alt: 'Blue Subaru Impreza 2.5RS parked beside the waterfront', label: 'Garage', href: `${aboutHref}#beyond-software` },
  { src: hikingThumb, width: 720, height: 518, alt: 'Quang standing with arms outstretched at a scenic lake overlook', label: 'Trail', href: `${aboutHref}#beyond-software` },
  { src: cameraThumb, width: 720, height: 900, alt: 'Golden sunset clouds reflected across waves at the edge of a lake', label: 'Lens', href: photographyPageHref },
];

const honors = [
  { name: 'Farash Foundation First in Family Scholar' },
  {
    name: 'Richard T. Cheng Endowed Scholarship',
    href: 'https://www.rit.edu/news/congratulations-our-2024-computer-science-scholarship-award-winners',
  },
  { name: 'Patrick P. Lee Scholarship' },
  { name: 'RIT Presidential Scholar' },
  { name: "Dean's List" },
];

/**
 * renders the about and education section
 * :returns: about and education markup
 */
function Education() {
  return (
    <section className="page-section section-background" id="about" aria-labelledby="about-title">
      <div className="section-inner">
        <div className="section-heading" data-reveal>
          <div><p className="eyebrow"><span className="section-index">05</span> Background</p><h2 id="about-title">About & education</h2></div>
          <p>I enjoy the parts of software engineering where application logic, data, APIs, and real operational problems meet.</p>
        </div>
        <div className="about-grid">
          <div className="about-card" data-reveal>
            <p className="about-card__lead">
              I like building practical software, but there’s more to me than what ends up in a repository.
            </p>
            <p>
              Outside the editor, I spend time around photography, cars, technology, gaming, music,
              and the occasional hike. My About page covers a little more of how I got into software,
              what I value when I build, and what I’m interested in beyond engineering.
            </p>
            <ul className="field-notes" aria-label="Outside the editor">
              {fieldNotes.map(({ src, width, height, alt, label, href }, index) => (
                <li key={label} style={{ '--i': index }}>
                  <a href={href} className="viewfinder">
                    <img src={src} width={width} height={height} alt={alt} loading="lazy" decoding="async" />
                    <span className="field-notes__label mono">{label}</span>
                  </a>
                </li>
              ))}
            </ul>
            <a className="text-link" href={aboutHref}>
              More about me →
            </a>
          </div>
          <article className="education-card" data-reveal style={{ '--reveal-delay': '120ms' }}>
            <div className="education-title">
              <a href="https://www.rit.edu/" target="_blank" rel="noopener noreferrer">
                <img className="institution-logo" src={ritLogo} width="860" height="860" alt="Rochester Institute of Technology" loading="lazy" decoding="async" />
              </a>
              <div><h3>Rochester Institute of Technology</h3><p className="degree">BS/MS Computer Science – Accelerated Program</p></div>
            </div>
            <dl className="education-meta">
              <div><dt>Expected graduation</dt><dd>2028</dd></div>
              <div><dt>GPA</dt><dd>3.42 / 4.00</dd></div>
            </dl>
            <p className="education-honors-title mono">Honors</p>
            <ul className="honors-list" aria-label="Academic honors">
              {honors.map((honor) => (
                <li key={honor.name}>
                  {honor.href ? (
                    <a href={honor.href} target="_blank" rel="noopener noreferrer">{honor.name}</a>
                  ) : (
                    honor.name
                  )}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

export default Education;
