import React from 'react';
import '../styles/footer.css';
import { FaLinkedin, FaGithub, FaEnvelope } from 'react-icons/fa'; // Social media icons

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <p>© {new Date().getFullYear()} <strong>Quang Huynh</strong> | Built with ❤️ in React</p>
        <p>I love my girlfriend!!</p>
        <div className="footer-icons">
          <a
            href="https://linkedin.com/in/quangs"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn"
          >
            <FaLinkedin className="footer-icon linkedin" />
          </a>
          <a
            href="https://github.com/quangshuynh"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
          >
            <FaGithub className="footer-icon github" />
          </a>
          <a
            href="mailto:qth9368@rit.edu"
            aria-label="Email"
          >
            <FaEnvelope className="footer-icon email" />
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
