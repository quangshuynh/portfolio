import React, { useState } from 'react';
import emailjs from '@emailjs/browser';
import '../styles/footer.css';
import useClickSound from '../hooks/useClickSound';

function Footer({ icons }) {
  const { FaGithub, FaLinkedin, FaEnvelope } = icons;
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({name: '', email: '', subject: '', message: '',});
  const [toast, setToast] = useState({ visible: false, message: '', type: '', });
  const { playOn, playOff, swoosh } = useClickSound();

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
    playOn();
    e.preventDefault();
    setShowModal(true);
  };

  const handleCloseModal = () => {
    playOff();
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
    swoosh();
    e.preventDefault();
    const templateParams = {
      name: formData.name,
      email: formData.email,
      subject: formData.subject,
      message: formData.message,
    };

    emailjs.send(serviceId, templateId, templateParams, publicKey)
      .then((response) => {
        console.log('SUCCESS!', response.status, response.text);
        showToast('Your message has been sent successfully!', 'success');
      }, (error) => {
        console.error('FAILED...', error);
        showToast('Oops! Something went wrong. Please try again.', 'error');
      });
  };

  return (
    <footer className="footer">
      <div className="footer-container">
        <p>© {new Date().getFullYear()} <strong>Quang Huynh</strong> | Built with ❤️ in React</p>
        <div className="footer-icons">
          <a href="https://linkedin.com/in/quangs" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" onClick={playOn}>
            <FaLinkedin className="footer-icon linkedin" />
          </a>
          <a href="https://github.com/quangshuynh" target="_blank" rel="noopener noreferrer" aria-label="GitHub" onClick={playOn}>
            <FaGithub className="footer-icon github" />
          </a>
          <a href="/#" aria-label="Email" onClick={handleOpenModal}>
            <FaEnvelope className="footer-icon email" />
          </a>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-container">
            <button className="modal-close" onClick={handleCloseModal}>&times;</button>
            <h2>Contact Me</h2>
            <form className="contact-form" onSubmit={handleSubmit}>
            <label htmlFor="name">Name</label>
              <input type="text" name="name" id="name" placeholder="Your name" value={formData.name} onChange={handleChange} required />

              <label htmlFor="email">Email</label>
              <input type="email" name="email" id="email" placeholder="your.email@example.com" value={formData.email} onChange={handleChange} required />

              <label htmlFor="subject">Subject</label>
              <input type="text" name="subject" id="subject" placeholder="What's this regarding?" value={formData.subject} onChange={handleChange} required />

              <label htmlFor="message">Message</label>
              <textarea name="message" id="message" rows="5" placeholder="Your message here..." value={formData.message} onChange={handleChange} required ></textarea>

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
    </footer>
  );
}

export default Footer;
