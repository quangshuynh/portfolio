import React from 'react';

const groups = [
  ['Languages', 'Python · Swift · TypeScript · JavaScript · C# · Java · SQL · C'],
  ['Frameworks & platforms', 'FastAPI · SwiftUI · React · Next.js · .NET/WPF · SQLAlchemy · pandas'],
  ['Data', 'PostgreSQL · SQL Server · SwiftData · Firebase'],
  ['Tools & practices', 'Git · Docker · GitHub Actions · pytest · Ruff · Linux · REST APIs · Boomi'],
];

/**
 * renders the curated engineering skill groups
 * :returns: skills section markup
 */
function TechStack() {
  return (
    <section className="page-section" id="skills" aria-labelledby="skills-title">
      <div className="section-inner">
        <div className="section-heading">
          <div><p className="eyebrow">Engineering toolkit</p><h2 id="skills-title">Skills</h2></div>
          <p>
            A focused toolkit spanning backend systems, developer tools, data workflows,
            native applications, automation, and frontend delivery.
          </p>
        </div>
        <div className="skills-grid">
          {groups.map(([title, items]) => <div className="skill-group" key={title}><h3>{title}</h3><p>{items}</p></div>)}
        </div>
      </div>
    </section>
  );
}

export default TechStack;
