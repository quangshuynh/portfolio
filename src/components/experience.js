import React from 'react';
import '../styles/experience.css';

function Experience() {
  const experiences = [
    { company: 'Company A', role: 'Software Intern', timeline: '2024 - 2025' },
    { company: 'People\'s Inc', role: 'Self Determination Assistant', timeline: 'Jul 2024 - Present' },
  ];

  return (
    <section id="experience">
      <h2>Experience</h2>
      <div className="experience-container">
        {experiences.map((exp, index) => (
          <div key={index} className="experience-card">
            <h3>{exp.company}</h3>
            <p><strong>{exp.role}</strong></p>
            <p>{exp.timeline}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Experience;
