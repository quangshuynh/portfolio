import React from 'react';
import koreLogo from '../../assets/optimized/kore-logo.webp';

const work = [
  {
    area: '.NET DESKTOP APPLICATIONS',
    detail: 'Developed C#/.NET WPF features using XAML and MVVM, including a configurable XML-generation interface that enabled business users to define Excel import mappings without manually editing configuration files. Redesigned maintenance part lookup with partial-match search and a results grid, improving access to part records.',
  },
  {
    area: 'SQL SERVER & WORKFLOW AUTOMATION',
    detail: 'Implemented SQL Server queries, stored procedures, and C# business logic to automate customer-specific order fulfillment, including carrier selection, shipping comments, and order status updates. Enhanced data validation, invoice reporting accuracy, and database-driven workflows across enterprise systems.',
  },
  {
    area: 'BOOMI & NETSUITE INTEGRATIONS',
    detail: 'Enhanced enterprise integration reliability by extending centralized error logging, implementing manual error-resolution workflows without requiring process reruns, and improving database event tracking. Built reusable Boomi test harnesses for inventory transfers and adjustments, and reproduced production integration failures in QA to support troubleshooting.',
  },
];

/**
 * renders professional software engineering experience
 * :returns: experience section markup
 */
function Experience() {
  return (
    <section className="page-section section-experience" id="experience" aria-labelledby="experience-title">
      <div className="section-inner">
        <div className="section-heading" data-reveal>
          <div>
            <p className="eyebrow">Professional work</p>
            <h2 id="experience-title">Experience</h2>
          </div>
          <p>
            Contributed to production enterprise software through C#/.NET application development, SQL Server automation, and Boomi/NetSuite integrations, focusing on operational efficiency, data reliability, and maintainable workflows.
          </p>
        </div>

        <article className="experience-card log-entry">
          <div className="experience-company" data-reveal>
            <p className="log-entry__period mono">
              <time dateTime="2025-01">Jan 2025</time>
              <span aria-hidden="true"> — </span>
              <time dateTime="2025-05">May 2025</time>
            </p>
            <a className="company-logo-link" href="https://www.korewireless.com/about-us" target="_blank" rel="noopener noreferrer">
              <img className="company-logo" src={koreLogo} width="336" height="224" alt="KORE Wireless" loading="lazy" decoding="async" />
            </a>
            <h3>KORE Wireless</h3>
            <p className="experience-role">IoT Software Engineering Co-op</p>
            <p className="experience-location">Rochester, NY</p>
            <ul className="experience-tech tech-tags" aria-label="Technologies used">
              <li>C#</li>
              <li>.NET</li>
              <li>WPF</li>
              <li>SQL Server</li>
              <li>Boomi</li>
              <li>NetSuite</li>
              <li>GitLab</li>
            </ul>
          </div>

          <div className="experience-details">
            <ol className="detail-list">
              {work.map(({ area, detail }, index) => (
                <li key={area} data-reveal style={{ '--reveal-delay': `${index * 90}ms` }}>
                  <span className="detail-list__area mono"><span aria-hidden="true">{String(index + 1).padStart(2, '0')} / </span>{area}</span>
                  <p>{detail}</p>
                </li>
              ))}
            </ol>

            <blockquote className="employer-feedback" data-reveal>
              <p>“He was able to work with greater independence than is expected of co-ops.”</p>
              <footer>
                <cite>Matt Telesky, Director of Software Engineering</cite>
              </footer>
            </blockquote>
          </div>
        </article>
      </div>
    </section>
  );
}

export default Experience;
