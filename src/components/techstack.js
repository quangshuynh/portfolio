import React from 'react';
import '../styles/techstack.css';

function TechStack() {
  const stack = ['Python', 'Java', 'HTML/CSS', 'JavaScript', 'C'];

  return (
    <section id="tech-stack">
      <h2>Tech Stack</h2>
      <div className="tech-container">
        {stack.map((tech, index) => (
          <span key={index} className="tech-tag">
            {tech}
          </span>
        ))}
      </div>
    </section>
  );
}

export default TechStack;
