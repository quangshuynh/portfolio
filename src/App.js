import logo from './logo.svg';
import './App.css';
import React from 'react';
import Header from './components/Header';
import Experience from './components/Experience';
import Education from './components/Education';
import Projects from './components/Projects';
import TechStack from './components/TechStack';
import Socials from './components/Socials';
import Footer from './components/Footer';

function App() {
  return (
    <div className="App">
      <img src={logo} className="App-logo" alt="logo" />
      <Header />
      <div className="content">
        <Experience />
        <Education />
        <Projects />
        <TechStack />
        <Socials />
      </div>
      <Footer />
    </div>
  );
}

export default App;
