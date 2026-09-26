import React from 'react';

// Regrouped from the existing toolkit by discipline; no new skills are claimed.
const groups = [
  { title: 'Backend', note: 'APIs, services, persistence', items: ['FastAPI', 'SQLAlchemy', 'REST APIs'] },
  { title: 'Native', note: 'Apple platforms & desktop', items: ['SwiftUI', 'SwiftData', '.NET / WPF'] },
  { title: 'Frontend', note: 'Web delivery', items: ['React', 'Next.js'] },
  { title: 'Data', note: 'Storage & analysis', items: ['PostgreSQL', 'SQL Server', 'Firebase', 'pandas'] },
  { title: 'Infrastructure & tooling', note: 'Shipping and keeping it working', items: ['Git', 'Docker', 'GitHub Actions', 'Linux', 'pytest', 'Ruff', 'Boomi'] },
  { title: 'Languages', note: 'Day to day', items: ['Python', 'Swift', 'TypeScript', 'JavaScript', 'C#', 'Java', 'SQL', 'C'] },
];

/**
 * renders the curated engineering skill groups
 * :returns: skills section markup
 */
function TechStack() {
  return (
    <section className="page-section section-skills" id="skills" aria-labelledby="skills-title">
      <div className="section-inner">
        <div className="section-heading" data-reveal>
          <div><p className="eyebrow"><span className="section-index">04</span> Engineering toolkit</p><h2 id="skills-title">Skills</h2></div>
          <p>
            A focused toolkit spanning backend systems, developer tools, data workflows,
            native applications, automation, and frontend delivery.
          </p>
        </div>
        <dl className="skills-grid spec-sheet">
          {groups.map(({ title, note, items }, index) => (
            <div className="skill-group" key={title} data-reveal style={{ '--reveal-delay': `${(index % 3) * 60}ms` }}>
              <dt>
                <span className="skill-group__index mono" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span className="skill-group__title">{title}</span>
                <span className="skill-group__note">{note}</span>
              </dt>
              <dd>
                <ul aria-label={`${title} skills`}>
                  {items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export default TechStack;
