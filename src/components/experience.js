import React from 'react';
import '../styles/experience.css';
import kore_logo from '../assets/kore-logo.png';
import people_inc_logo from '../assets/people-inc-logo.png';

function Experience() {
  const experiences = [
    {
      company: 'KORE Wireless',
      role: 'Software Engineer Intern',
      timeline: 'Jan. 2025 - May 2025',
      logo: kore_logo, 
    },
    {
      company: 'People Inc',
      role: 'Self Determination Assistant',
      timeline: 'Jul. 2024 - Present',
      logo: people_inc_logo, 
    },
  ];

  return (
    <section id="experience" className="experience-section">
      <h2>Experience</h2>
      <div className="experience-container">
        {experiences.map((exp, index) => (
          <div key={index} className="experience-card">
            <div className="card-header">
              <img src={exp.logo} alt={`${exp.company} logo`} className="company-logo" />
              <div className="experience-details">
                <h3>{exp.company}</h3>
                <p><strong>{exp.role}</strong></p>
                <p>{exp.timeline}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Experience;
