import React from 'react';
import ritLogo from '../assets/logos/rit-logo.png';

const honors = [
  'Farash Foundation First in Family Scholar',
  'Richard T. Cheng Endowed Scholarship',
  'Patrick P. Lee Scholarship',
  'RIT Presidential Scholar',
  "Dean's List",
];

/**
 * renders the about and education section
 * :returns: about and education markup
 */
function Education() {
  return (
    <section className="page-section" id="about" aria-labelledby="about-title">
      <div className="section-inner">
        <div className="section-heading">
          <div><p className="eyebrow">Background</p><h2 id="about-title">About & education</h2></div>
          <p>I enjoy the parts of software engineering where application logic, data, APIs, and real operational problems meet.</p>
        </div>
        <div className="about-grid">
          <div className="about-card">
            <p>I’m a software developer based in Rochester, NY.</p>
            <p>
              I gravitate toward practical software: backend systems, developer tools,
              automation, native applications, and projects where reliability and
              thoughtful engineering matter.
            </p>
          </div>
          <article className="education-card">
            <div className="education-title">
              <img className="institution-logo" src={ritLogo} alt="Rochester Institute of Technology" loading="lazy" />
              <div><h3>Rochester Institute of Technology</h3><p className="degree">BS/MS Computer Science – Accelerated Program</p></div>
            </div>
            <div className="education-meta"><span>Expected graduation: 2028</span><span>GPA: 3.42 / 4.00</span></div>
            <ul className="honors-list" aria-label="Academic honors">
              {honors.map((honor) => <li key={honor}>{honor}</li>)}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

export default Education;
