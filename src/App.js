import './App.css';
import React from 'react';
import { Route, HashRouter as Router, Routes } from "react-router-dom";
import { FaGithub, FaLinkedin, FaEnvelope } from 'react-icons/fa';
import Header from './components/header';
import Experience from './components/experience';
import Education from './components/education';
import FeaturedProjects from './components/featuredProjects';
import MoreProjects from './components/moreProjects';
import TechStack from './components/techstack';
import Footer from './components/footer';
import { SoundProvider } from './hooks/SoundProvider';
import MuteButton from './components/muteButton';

function Home() {
  return (
    <div className="App">
      <Header icons={{ FaGithub, FaLinkedin, FaEnvelope }}/>
      <div className="content">
        <Experience />
        <Education />
        <FeaturedProjects />
        <TechStack />
      </div>
      <Footer icons={{ FaGithub, FaLinkedin, FaEnvelope }} />
    </div>
  );
}

function App() {
  return (
    <SoundProvider>
      <Router>
      <MuteButton />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/moreprojects" element={<MoreProjects icons={{ FaGithub, FaLinkedin, FaEnvelope }} />} />
        </Routes>
      </Router>
    </SoundProvider>
  );
}

export default App;
