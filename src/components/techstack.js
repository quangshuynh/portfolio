import React from 'react';
import '../styles/techstack.css';

function TechStack() {
  const languages = [
    { name: 'Python', logo: 'https://cdn.svgporn.com/logos/python.svg', proficiency: 'Expert' },
    { name: 'HTML', logo: 'https://cdn.svgporn.com/logos/html-5.svg', proficiency: 'Expert' },
    { name: 'CSS', logo: 'https://cdn.svgporn.com/logos/css-3.svg', proficiency: 'Expert' },
    { name: 'Java', logo: 'https://cdn.svgporn.com/logos/java.svg', proficiency: 'Advanced' },
    { name: 'JavaScript', logo: 'https://cdn.svgporn.com/logos/javascript.svg', proficiency: 'Advanced' },
    { name: 'C', logo: 'https://cdn.svgporn.com/logos/c.svg', proficiency: 'Intermediate' },
    { name: 'C#', logo: 'https://cdn.svgporn.com/logos/c-sharp.svg', proficiency: 'Beginner' },
  ];
  const frameworks = [
    { name: 'Flask', logo: 'https://cdn.svgporn.com/logos/flask.svg', proficiency: 'Expert' },
    { name: 'React', logo: 'https://cdn.svgporn.com/logos/react.svg', proficiency: 'Advanced' },
    { name: 'JavaFX', logo: 'https://cdn.svgporn.com/logos/java.svg', proficiency: 'Intermediate' },
    { name: 'Tkinter', logo: 'https://i.imgur.com/g6am5XO.png', proficiency: 'Intermediate' },
    { name: 'PyTorch', logo: 'https://cdn.svgporn.com/logos/pytorch-icon.svg', proficiency: 'Intermediate' },
    { name: 'LLMs', logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/ollama.png', proficiency: 'Intermediate' },
    { name: 'Weaviate', logo: 'https://d11a6trkgmumsb.cloudfront.net/original/4X/8/1/1/811ef156e2525559c859ecdb7a5cd26d5e459e46.png', proficiency: 'Intermediate' },
    { name: 'NumPy', logo: 'https://cdn.svgporn.com/logos/numpy.svg', proficiency: 'Advanced' },
    { name: 'Pandas', logo: 'https://cdn.svgporn.com/logos/pandas-icon.svg', proficiency: 'Advanced' },
    { name: 'Matplotlib', logo: 'https://cdn.svgporn.com/logos/matplotlib.svg', proficiency: 'Advanced' },
    { name: 'Computer Vision', logo: 'https://cdn.svgporn.com/logos/opencv.svg', proficiency: 'Beginner' },
  ];
  const tools = [
    { name: 'Git', logo: 'https://cdn.svgporn.com/logos/git-icon.svg' },
    { name: 'Linux', logo: 'https://cdn.svgporn.com/logos/linux-tux.svg' },
    { name: 'PyCharm', logo: 'https://cdn.svgporn.com/logos/pycharm.svg' },
    { name: 'IntelliJ', logo: 'https://cdn.svgporn.com/logos/intellij-idea.svg' },
    { name: 'VSCode', logo: 'https://cdn.svgporn.com/logos/visual-studio-code.svg' },
    { name: 'Replit', logo: 'https://cdn.svgporn.com/logos/replit-icon.svg' },
    { name: 'MobaXterm', logo: 'https://onion.io/wp-content/uploads/2017/11/Moba-Logo.jpg' },
  ];

  // helper function
  const renderCards = (items) =>
    items.map((item, index) => (
      <div key={index} className="tech-card">
        <img src={item.logo} alt={`${item.name} logo`} className="tech-logo" />
        <div className="tech-details">
          <h3>{item.name}</h3>
        </div>
      </div>
    ));

    return (
      <section id="tech-stack" className="techstack-section">
        <h2 id="tech">Languages</h2>
        <div className="stack-container">{renderCards(languages)}</div>
  
        <h2 id="frameworks">Frameworks</h2>
        <div className="stack-container">{renderCards(frameworks)}</div>
  
        <h2 id="tools">Tools</h2>
        <div className="tools-container">{renderCards(tools)}</div>
      </section>
    );
  }
  
  export default TechStack;
