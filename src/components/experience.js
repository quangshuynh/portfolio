import React from 'react';
import koreLogo from '../assets/logos/kore-logo.png';

/**
 * renders professional software engineering experience
 * :returns: experience section markup
 */
function Experience() {
  return (
    <section
      className="page-section scroll-panel section-reveal"
      id="experience"
      aria-labelledby="experience-title"
    >
      <div className="section-inner reveal-content">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Professional work</p>
            <h2 id="experience-title">Experience</h2>
          </div>

          <p>
            Production software engineering across .NET desktop applications, 
            SQL Server workflows, and Boomi/NetSuite enterprise integrations.
          </p>
        </div>

        <article className="experience-card">
          <div className="experience-company">
            <a
              href="https://www.korewireless.com/about-us"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                className="company-logo"
                src={koreLogo}
                alt="KORE Wireless"
              />
            </a>
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

          <div className="experience-details">
            <ul className="detail-list">
              <li>
                Developed C#/.NET WPF features for internal business applications using XAML and MVVM, including a configurable XML-generation workflow for Excel imports and a partial-match search interface for maintenance tooling.
              </li>

              <li>
                Built and modified SQL Server queries and stored procedures for order automation, validation, reporting, and data-quality workflows, including logic that automatically updated shipping methods, order comments, and processing status based on business rules.
              </li>

              <li>
                Improved Boomi/NetSuite integration reliability and supportability by extending centralized error tracking and manual resolution workflows, building reusable transaction test harnesses, and reproducing production integration failures in QA.
              </li>
            </ul>

            <blockquote className="employer-feedback">
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
