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
      about: [
        'Incoming Software Engineer Intern for Spring 2025',
      ],
    },
    {
      company: 'People Inc.',
      role: 'Self Determination Assistant',
      timeline: 'Jul. 2024 - Present',
      logo: people_inc_logo, 
      about: [
        'Used service plans to assist mentally-disabled individuals with daily tasks, shown by progress toward personal goals.',
        'Managed budgeting, transportation, and care tasks, ensuring high accuracy and satisfaction.',
        'Documented improvements and maintained detailed records to ensure data accuracy and regulatory compliance.',
      ],
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
            <div className="about-container">
              <ul className="about-list">
                {exp.about.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Experience;
