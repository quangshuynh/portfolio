import React from 'react';
import { FaEnvelope, FaGithub, FaLinkedin } from 'react-icons/fa';
import { Ridgeline, TopoField } from '../ui/terrain';

/**
 * renders contact links and site attribution
 * :returns: contact section and footer markup
 */
function Footer() {
  return (
    <>
      <section className="contact-section" id="contact" aria-labelledby="contact-title">
        <TopoField variant="quiet" className="contact-topo" />
        <div className="section-inner contact-inner">
          <p className="eyebrow" data-reveal>Contact · Trailhead</p>
          <h2 id="contact-title" data-reveal>Let’s talk about building useful software.</h2>
          <p className="contact-lede" data-reveal>
            I’m open to software engineering opportunities and always glad to connect
            with recruiters, engineering teams, and other developers.
          </p>

          <div className="contact-links" data-reveal>
            <a className="button" href="mailto:quang@quanghuynh.com">
              <FaEnvelope aria-hidden="true" /> Email me
            </a>
            <a className="button button-secondary" href="https://github.com/quangshuynh" target="_blank" rel="noreferrer">
              <FaGithub aria-hidden="true" /> GitHub
            </a>
            <a className="button button-secondary" href="https://linkedin.com/in/quangs" target="_blank" rel="noreferrer">
              <FaLinkedin aria-hidden="true" /> LinkedIn
            </a>
          </div>
        </div>
        <Ridgeline className="contact-ridge" />
      </section>
      <footer className="site-footer">
        <div className="footer-inner section-inner">
          <p>© {new Date().getFullYear()} Quang Huynh</p>
          <p className="mono footer-coords" aria-hidden="true">43.16° N · 77.61° W · Rochester, NY</p>
          <p>Designed and built with React.</p>
        </div>
      </footer>
    </>
  );
}

export default Footer;
