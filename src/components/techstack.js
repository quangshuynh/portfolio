import React from 'react';

const groups = [
  ['Languages', 'Python · C# · Java · JavaScript · SQL · C · HTML/CSS'],
  ['Frameworks & libraries', '.NET · WPF · FastAPI · Flask · React · SQLAlchemy · pandas · PyTorch'],
  ['Data', 'PostgreSQL · SQL Server · Firebase · Weaviate'],
  ['Tools & practices', 'Git · Docker · GitHub Actions · pytest · Linux · REST APIs · XAML · MVVM · Boomi · SSMS'],
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
          <p>A focused toolkit spanning backend services, data systems, desktop applications, automation, and frontend delivery.</p>
        </div>
        <div className="skills-grid">
          {groups.map(([title, items]) => <div className="skill-group" key={title}><h3>{title}</h3><p>{items}</p></div>)}
        </div>
      </div>
    </section>
  );
}

export default TechStack;
