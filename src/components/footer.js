import React from 'react';
import { FaEnvelope, FaGithub, FaLinkedin } from 'react-icons/fa';

/**
 * renders contact links and site attribution
 * :returns: contact section and footer markup
 */
function Footer() {
  return (
    <>
      <section className="contact-section" id="contact" aria-labelledby="contact-title">
        <div className="section-inner">
          <p className="eyebrow">Contact</p>
          <h2 id="contact-title">Let’s talk about building useful software.</h2>
          <p>I’m always glad to connect with recruiters, engineering teams, and other technical professionals.</p>
          <div className="contact-links">
            <a className="button" href="mailto:20378quang@gmail.com"><FaEnvelope aria-hidden="true" /> Email me</a>
            <a className="button button-secondary" href="https://github.com/quangshuynh" target="_blank" rel="noreferrer"><FaGithub aria-hidden="true" /> GitHub</a>
            <a className="button button-secondary" href="https://linkedin.com/in/quangs" target="_blank" rel="noreferrer"><FaLinkedin aria-hidden="true" /> LinkedIn</a>
          </div>
        </div>
      </section>
      <footer className="site-footer">
        <div className="footer-inner"><p>© {new Date().getFullYear()} Quang Huynh</p><p>Designed and built with React.</p></div>
      </footer>
    </>
  );
}

export default Footer;
