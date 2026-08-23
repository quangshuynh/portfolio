import React from 'react';
import koreLogo from '../assets/kore-logo.png';

/**
 * renders professional software engineering experience
 * :returns: experience section markup
 */
function Experience() {
  return (
    <section
      className="page-section"
      id="experience"
      aria-labelledby="experience-title"
    >
      <div className="section-inner">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Professional work</p>
            <h2 id="experience-title">Experience</h2>
          </div>

          <p>
            Production software engineering across desktop applications,
            SQL-backed workflows, and enterprise integrations.
          </p>
        </div>

        <article className="experience-card">
          <div className="experience-company">
            <img
              className="company-logo"
              src={koreLogo}
              alt="KORE Wireless"
            />
            <h3>KORE Wireless</h3>
            <p className="experience-role">IoT Software Engineering Co-op</p>
            <p>
              <time dateTime="2025-01">Jan 2025</time>
              {' – '}
              <time dateTime="2025-05">May 2025</time>
            </p>
            <p>Rochester, NY</p>

            <ul className="experience-tech" aria-label="Technologies used">
              <li>C#</li>
              <li>.NET / WPF</li>
              <li>SQL Server</li>
              <li>Boomi</li>
              <li>NetSuite</li>
            </ul>
          </div>

          <ul className="detail-list">
            <li>
              Developed production features for a large .NET/WPF application
              using C#, XAML, and MVVM, including search workflows and
              configurable XML generation for business data imports.
            </li>

            <li>
              Built and modified SQL Server stored procedures and queries
              supporting order automation, validation, reporting accuracy,
              and bulk data workflows.
            </li>

            <li>
              Improved Boomi and NetSuite integration workflows through
              enhanced error tracking, resolution tooling, QA test harnesses,
              and production-failure investigation.
            </li>
          </ul>
        </article>
      </div>
    </section>
  );
}

export default Experience;