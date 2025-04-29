import React, { useState } from 'react';
import { CSSTransition, SwitchTransition } from 'react-transition-group';
import '../styles/experience.css';
import kore_logo from '../assets/kore-logo.png';
import people_inc_logo from '../assets/people-inc-logo.png';
import useClickSound from '../hooks/useClickSound';

function Experience() {
  const [season, setSeason] = useState('spring');
  const [direction, setDirection] = useState('right'); 
  const { playOn } = useClickSound();

  const experiences = [
    {
      company: 'KORE Wireless',
      role: 'IoT Software Engineering Co-op',
      timeline: season === 'spring' ? 'Jan. 2025 - May 2025' : 'Offer rescinded',
      team: 'Enterprise Applications Team',
      logo: kore_logo,
      url: 'https://www.korewireless.com/about-us',
      about:
      season === 'spring'
          ? [
              'Developed and maintained .NET WPF UI features in a large legacy codebase to streamline order processing workflows for internal users using XAML & MVVM architecture',
              'Designed and optimized SQL stored procedures to enhance database performance and support backend operations',
              'Integrated and automated data workflows using Boomi in an Agile Scrum environment, improving operational efficiency and cross-system communication',
              'Created dynamic RDL reports to provide real-time business insights and support decision-making across departments',
            ]
          : [
              'Software Engineer Intern offer for Summer 2025 rescinded because Rochester offices were closing. Unfortunate',
            ],
    },
    {
      company: 'People Inc.',
      role: 'Self Determination Assistant',
      timeline: 'Jul. 2024 - Present',
      url: 'https://www.people-inc.org/about/people-inc/',
      logo: people_inc_logo,
      about: [
        'Used service plans to assist mentally-disabled individuals with daily tasks, shown by progress toward personal goals',
        'Managed budgeting, transportation, and care tasks, ensuring high accuracy and satisfaction',
        'Documented improvements and maintained detailed records to ensure data accuracy and regulatory compliance',
      ],
    },
  ];

  const handleSeasonChange = (newSeason) => {
    if (newSeason === 'summer') {
      setDirection('left');
    } else {
      setDirection('right');
    }
    setSeason(newSeason);
  };

  return (
    <section id="experience" className="experience-section">
      <h2>Experience</h2>
      <div className="experience-container">
        {experiences.map((exp, index) => (
          <div key={index} className="experience-card">
            <div className="card-header">
              <a href={exp.url} target="_blank" rel="noopener noreferrer" onClick={playOn}>
                <img src={exp.logo} alt={`${exp.company} logo`} className="company-logo" />
              </a>
              <div className="experience-details">
                <a href={exp.url} target="_blank" rel="noopener noreferrer" onClick={playOn}>
                  <h3>{exp.company}</h3>
                </a>
                <p><strong>{exp.role}</strong></p>
                {exp.company === 'KORE Wireless' ? (
                  <SwitchTransition mode="out-in">
                    <CSSTransition
                      key={season}
                      addEndListener={(node, done) =>
                        node.addEventListener("transitionend", done, false)
                      }
                      classNames={`slide-${direction}`}
                    >
                      <p>{exp.timeline}</p>
                    </CSSTransition>
                  </SwitchTransition>
                ) : (
                  <p>{exp.timeline}</p>
                )}
                {exp.team && <p><em>{exp.team}</em></p>}

                {exp.company === 'KORE Wireless' && (
                  <div className="toggle-button-group">
                    <button
                      className={`season-button ${season === 'spring' ? 'active' : ''}`}
                      onClick={() => {playOn(); handleSeasonChange('spring')}}>
                      Spring
                    </button>
                    <button
                      className={`season-button ${season === 'summer' ? 'active' : ''}`}
                      onClick={() => {playOn(); handleSeasonChange('summer')}}>
                      Summer
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="about-container">
              {exp.company === 'KORE Wireless' ? (
                <SwitchTransition mode="out-in">
                  <CSSTransition
                    key={season}
                    addEndListener={(node, done) =>
                      node.addEventListener("transitionend", done, false)
                    }
                    classNames="about-slide"
                  >
                    <ul className="about-list">
                      {exp.about.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </CSSTransition>
                </SwitchTransition>
              ) : (
                <ul className="about-list">
                  {exp.about.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Experience;
