import './App.css';
import React from 'react';
import Header from './components/header';
import Experience from './components/experience';
import Education from './components/education';
import Projects from './components/projects';
import TechStack from './components/techstack';
import Footer from './components/footer';

function App() {
  return (
    <div className="App">
      <Header />
      <div className="content">
        <Experience />
        <Education />
        <Projects />
        <TechStack />
      </div>
      <Footer />
    </div>
  );
}

export default App;
