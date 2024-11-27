import React from 'react';

function Footer() {
  return (
    <footer>
      <p>
        © {new Date().getFullYear()} <strong>Quang Huynh</strong> | Built with ❤️ in React
      </p>
    </footer>
  );
}

export default Footer;