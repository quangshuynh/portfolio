import React from 'react';
import '../styles/header.css';

function Header() {
  return (
    <div className="header">
      <h1>Hey there! 👋</h1>
      <h2>
        I'm <span className="highlight">Quang Huynh</span>, an aspiring software engineer focused on impactful experiences.
      </h2>
      <p>Contact me: <a href="mailto:qth9368@rit.edu">qth9368@rit.edu</a></p>
    </div>
  );
}

export default Header;
