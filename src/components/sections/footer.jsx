import React from 'react';
import { FaEnvelope, FaFilePdf, FaGithub, FaLinkedin } from 'react-icons/fa';
import { Ridgeline, TopoField } from '../ui/terrain';
import { aboutHref, photographyPageHref } from './siteNav';

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
          <p className="eyebrow" data-reveal>Contact</p>
          <h2 id="contact-title" data-reveal>Let’s talk about building useful software.</h2>
          <p className="contact-lede" data-reveal>
            I’m open to software engineering internships and co-op opportunities, especially
            in backend systems, full-stack development, automation, and developer tooling.
            I’m always glad to connect with recruiters, engineering teams, and other developers.
          </p>

          <div className="contact-links" data-reveal>
            <a className="button" href="mailto:quang@quanghuynh.com?subject=Let%27s%20Connect!&body=Hi%20Quang%2C%0A%0AI%20came%20across%20your%20portfolio%20and%20wanted%20to%20reach%20out.%20I%27d%20love%20to%20connect%20and%20chat%20about..." target="_blank" rel="noreferrer">
              <FaEnvelope aria-hidden="true" /> Email me
            </a>
            <a className="button button-secondary" href="https://github.com/quangshuynh" target="_blank" rel="noreferrer">
              <FaGithub aria-hidden="true" /> GitHub
            </a>
            <a className="button button-secondary" href="https://linkedin.com/in/quangs" target="_blank" rel="noreferrer">
              <FaLinkedin aria-hidden="true" /> LinkedIn
            </a>
            <a className="button button-secondary" href={`${import.meta.env.BASE_URL}Quang_Huynh_Resume.pdf`} target="_blank" rel="noreferrer">
              <FaFilePdf aria-hidden="true" /> Résumé{' '}<span className="visually-hidden">(PDF, opens in a new tab)</span>
            </a>
          </div>
        </div>
        <Ridgeline className="contact-ridge" />
      </section>
      <footer className="site-footer">
        <div className="footer-inner section-inner">
          <p>© {new Date().getFullYear()} Quang Huynh</p>
          <nav className="footer-links" aria-label="More">
            <a href={aboutHref}>About Quang</a>
            <a href={photographyPageHref}>Photography</a>
            <a href={`${import.meta.env.BASE_URL}Quang_Huynh_Resume.pdf`} target="_blank" rel="noreferrer">Résumé{' '}<span className="visually-hidden">(PDF, opens in a new tab)</span></a>
          </nav>
          <p>Designed and built with React.</p>
        </div>
      </footer>
    </>
  );
}

export default Footer;
