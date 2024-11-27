import React from 'react';
import '../styles/header.css';

function Header() {
  return (
    <div className="header">
      <div className="profile">
        <img
          src="https://i.imgur.com/6QbgYeB.png"
          alt="Quang profile picture"
          className="profile-pic"
        />
      </div>
      <h1>Hey there! 👋</h1>
      <h2>
        I'm <span className="highlight">Quang Huynh</span>, a creative software
        engineer driven by impactful solutions.
      </h2>
      <p>
        Email me @ <a href="mailto:qth9368@rit.edu">qth9368@rit.edu</a>
      </p>
    </div>
  );
}

export default Header;
