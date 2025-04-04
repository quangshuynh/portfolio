import React, { useState } from 'react';
import '../styles/experience.css';
import kore_logo from '../assets/kore-logo.png';
import people_inc_logo from '../assets/people-inc-logo.png';

function Experience() {
  const [koreSeason, setKoreSeason] = useState('spring');

  const experiences = [
    {
      company: 'KORE Wireless',
      role: 'Software Engineering Intern',
      timeline: koreSeason === 'spring' ? 'Jan. 2025 - May 2025' : 'May 2025 - Aug. 2025',  //todo: add sliding transition
      team: 'Enterprise Applications Team',
      logo: kore_logo,
      url: 'https://www.korewireless.com/about-us',
      about:
        koreSeason === 'spring'
          ? [ // spring 2025
              'Developed and maintained .NET UI features in a large legacy codebase to streamline order processing workflows for internal users',
              'Designed and optimized SQL stored procedures to enhance database performance and support backend operations',
              'Integrated and automated data workflows using Boomi in an Agile Scrum environment, improving operational efficiency and cross-system communication',
              'Created dynamic RDL reports to provide real-time business insights and support decision-making across departments',
            ]
          : [  // summer 2025
              'Incoming Software Engineering Intern for Summer 2025',
            ],
    },
    {
      company: 'People Inc.',
      role: 'Self Determination Assistant',
      timeline: 'Jul. 2024 - Present',
      url: 'https://www.people-inc.org/about/people-inc/',
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
              <a href={exp.url} target="_blank" rel="noopener noreferrer">
                <img src={exp.logo} alt={`${exp.company} logo`} className="company-logo" />
              </a>
              <div className="experience-details">
                <a href={exp.url} target="_blank" rel="noopener noreferrer">
                  <h3>{exp.company}</h3>
                </a>
                <p><strong>{exp.role}</strong></p>
                <p>{exp.timeline}</p>
                {exp.team && <p><em>{exp.team}</em></p>}

                {exp.company === 'KORE Wireless' && (
                  <div className="toggle-button-group">
                    <button
                      className={`season-button ${koreSeason === 'spring' ? 'active' : ''}`}
                      onClick={() => setKoreSeason('spring')}
                    >
                      Spring
                    </button>
                    <button
                      className={`season-button ${koreSeason === 'summer' ? 'active' : ''}`}
                      onClick={() => setKoreSeason('summer')}
                    >
                      Summer
                    </button>
                  </div>
                )}
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
