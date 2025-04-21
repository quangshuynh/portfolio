import React, { useState } from 'react';
import emailjs from '@emailjs/browser';
import '../styles/header.css';
import useClickSound from '../hooks/useClickSound'

function Header({ icons }) {
  const { FaGithub, FaLinkedin, FaEnvelope } = icons;
  const { playOn, playOff, swoosh } = useClickSound();
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({name: '', email: '', subject: '', message: '',});
  const [toast, setToast] = useState({ visible: false, message: '', type: '', });

  const serviceId = process.env.REACT_APP_CONTACT_FORM_EMAILJS_SERVICE_ID;
  const templateId = process.env.REACT_APP_CONTACT_FORM_EMAILJS_TEMPLATE;
  const publicKey = process.env.REACT_APP_CONTACT_FORM_EMAILJS_PUBLIC_KEY;

  const showToast = (message, type) => {
    setToast({ visible: true, message, type });

    setTimeout(() => {
      setToast({ visible: false, message: '', type: '' });
    }, 3000);
  };

  const handleOpenModal = (e) => {
    e.preventDefault();
    playOn()
    setShowModal(true);
  };

  const handleCloseModal = () => {
    playOff()
    setShowModal(false);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    swoosh();
    const templateParams = {
      name: formData.name,
      email: formData.email,
      subject: formData.subject,
      message: formData.message,
    };

    emailjs.send(serviceId, templateId, templateParams, publicKey)
      .then(
        (response) => {
          console.log('SUCCESS!', response.status, response.text);
          showToast('Your message has been sent successfully!', 'success');
        },
        (error) => {
          console.error('FAILED...', error);
          showToast('Oops! Something went wrong. Please try again.', 'error');
        }
      );
  };

  return (
    <div className="header">
      <div className="profile">
        <img src="https://i.imgur.com/Ok3lkvw.jpeg" alt="Quang Huynh" className="profile-pic"/>
      </div>
      <h1 className="header-title">
        Hey there! <span className="wave">👋</span>
      </h1>
      <h2 className="header-subtitle">
        I&apos;m <span className="highlight">Quang Huynh</span>, a creative software
        engineer driven by impactful solutions
      </h2>
      <a href="Quang_Huynh_Resume.pdf" target="_blank" rel="noopener noreferrer" onClick={() => { playOn(); }}>
        <button className="cv-button">Download CV</button>
      </a>
      <div className="social-icons">
        <a href="https://linkedin.com/in/quangs" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" onClick={() => { playOn(); }}>
          <FaLinkedin className="icon linkedin" />
        </a>
        <a href="https://github.com/quangshuynh" target="_blank" rel="noopener noreferrer" aria-label="GitHub" onClick={() => { playOn(); }}>
          <FaGithub className="icon github" />
        </a>
        <a href="/#" aria-label="Email" onClick={handleOpenModal}>
          <FaEnvelope className="icon email" />
        </a>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-container">
            <button className="modal-close" onClick={handleCloseModal}>
              &times;
            </button>
            <h2>Contact Me</h2>
            <form className="contact-form" onSubmit={handleSubmit}>
            <label htmlFor="name">Name</label>
              <input type="text" name="name" id="name" placeholder="Your name" value={formData.name} onChange={handleChange} required style={{ fontFamily: 'monospace'}}/>

              <label htmlFor="email">Email</label>
              <input type="email" name="email" id="email" placeholder="your.email@example.com" value={formData.email} onChange={handleChange} required style={{ fontFamily: 'monospace'}}/>

              <label htmlFor="subject">Subject</label>
              <input type="text" name="subject" id="subject" placeholder="What's this regarding?" value={formData.subject} onChange={handleChange} required style={{ fontFamily: 'monospace'}}/>

              <label htmlFor="message">Message</label>
              <textarea name="message" id="message" rows="5" placeholder="Your message here..." value={formData.message} onChange={handleChange} required style={{ fontFamily: 'monospace'}}></textarea>

              <button type="submit" className="send-button">Send Message</button>
            </form>
          </div>
        </div>
      )}

      {toast.visible && (
        <div className={`toast-container ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default Header;
