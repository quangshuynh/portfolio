import React from 'react';
import '../styles/education.css';
import rit_logo from '../assets/rit-logo.png';
import useClickSound from '../hooks/useClickSound';

function Education() {
  const { playOn } = useClickSound();
  const education = [
    {
      institution: 'Rochester Institute of Technology',
      degree: 'Accelerated B.S./M.S. in Computer Science',
      timeline: 'Expected Dec. 2027',
      gpa: '3.63 / 4.00',
      url: 'https://www.rit.edu',
      logo: rit_logo,
      honors: [
        'Presidential Scholarship Recipient',
        'Richard T. Cheng Endowed Scholarship',
        'Farash Foundation’s First in Family Scholar',
        'Dean’s List (Fall 2023 - 2025)'
      ],
      involvement: [
        'RIT AI Club',
        'Computing Organization for Multicultural Students',
        'Vietnamese Student Association',
        'RIT Car Club'
      ],
    },
  ];

  return (
    <section id="education" className="education-section">
      <h2>Education</h2>
      <div className="education-container">
        {education.map((edu, index) => (
          <div key={index} className="education-card">
            <div className="card-header">
            <a href={edu.url} target="_blank" rel="noopener noreferrer" onClick={playOn}>
              <img src={edu.logo} alt={`${edu.institution} logo`} className="institution-logo" />
            </a>
            <div className="institution-info">
              <h3>{edu.institution}</h3>
              <p><strong>{edu.degree}</strong></p>
              <p>{edu.timeline}</p>
              <p className="gpa">GPA: {edu.gpa}</p> 
            </div>
          </div>
          <div className="education-subsections">
            <div className="honors">
              <h4>Honors</h4>
              <ul>
                {edu.honors.map((honor, i) => (
                  <li key={i}>{honor}</li>
                ))}
              </ul>
            </div>
            <div className="activities">
              <h4>Involvement</h4>
              <ul>
                {edu.involvement.map((activity, i) => (
                  <li key={i}>{activity}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
  );
}

export default Education;
