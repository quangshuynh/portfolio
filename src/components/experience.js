import React from 'react';
import koreLogo from '../assets/kore-logo.png';

/**
 * renders professional software engineering experience
 * :returns: experience section markup
 */
function Experience() {
  return (
    <section className="page-section" id="experience" aria-labelledby="experience-title">
      <div className="section-inner">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Professional work</p>
            <h2 id="experience-title">Experience</h2>
          </div>
          <p>Building application features, database functionality, and enterprise workflows on a collaborative software engineering team.</p>
        </div>
        <article className="experience-card">
          <div className="experience-company">
            <img className="company-logo" src={koreLogo} alt="KORE Wireless" />
            <h3>KORE Wireless</h3>
            <p className="experience-role">IoT Software Engineering Co-op</p>
            <p><time dateTime="2025-01">Jan 2025</time> - <time dateTime="2025-05">May 2025</time></p>
            <p>Rochester, NY</p>
          </div>
          <ul className="detail-list">
            <li>Maintained and enhanced UI functionality in a large-scale .NET/WPF application using C#, XAML, and MVVM architecture.</li>
            <li>Developed and optimized SQL stored procedures supporting backend operations and database performance.</li>
            <li>Automated enterprise data workflows with Boomi and collaborated within an Agile/Scrum software engineering team.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}

export default Experience;
