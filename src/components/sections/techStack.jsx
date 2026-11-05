import React from 'react';

// Each item is used in a project or role shown on this page (see projects.mjs
// and the experience section); nothing is listed from coursework alone.
const groups = [
  { title: 'Backend', note: 'APIs, services, persistence', items: ['FastAPI', 'SQLAlchemy', 'Alembic', 'REST APIs', 'Webhooks', 'Transactional outbox'] },
  { title: 'Native', note: 'Apple platforms, mobile & desktop', items: ['SwiftUI', 'SwiftData', 'AppKit', 'ScreenCaptureKit', 'Flutter', '.NET / WPF'] },
  { title: 'Web', note: 'Product & browser engineering', items: ['React', 'Next.js', 'Vite', 'WebGL', 'WebAssembly', 'Web Workers'] },
  { title: 'Data', note: 'Storage & analysis', items: ['PostgreSQL', 'SQL Server', 'SQLite', 'Supabase', 'pandas'] },
  { title: 'Infrastructure & tooling', note: 'Delivery, automation & reliability', items: ['Git', 'Docker', 'GitHub Actions', 'GitLab', 'Linux', 'Cloudflare Workers', 'Vercel', 'pytest', 'Swift Testing', 'Playwright', 'Ruff', 'Boomi'] },
  { title: 'Languages', note: 'Day to day', items: ['Python', 'Swift', 'TypeScript', 'JavaScript', 'C#', 'SQL', 'Dart', 'Java', 'C'] },
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
          <div><p className="eyebrow">Engineering toolkit</p><h2 id="skills-title">Skills</h2></div>
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
