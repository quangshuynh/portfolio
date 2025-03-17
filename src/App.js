import './App.css';
import React from 'react';
import { Route, HashRouter as Router, Routes } from "react-router-dom";
import Header from './components/header';
import Experience from './components/experience';
import Education from './components/education';
import FeaturedProjects from './components/featuredProjects';
import MoreProjects from './components/moreProjects';
import TechStack from './components/techstack';
import Footer from './components/footer';
import { FaGithub, FaLinkedin, FaEnvelope } from 'react-icons/fa';

function Home() {
  return (
    <div className="App">
      <Header />
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
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/moreprojects" element={<MoreProjects icons={{ FaGithub, FaLinkedin, FaEnvelope }} />} />
      </Routes>
    </Router>
  );
}

export default App;
