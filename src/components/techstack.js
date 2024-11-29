import React from 'react';
import '../styles/techstack.css';

function TechStack() {
  const techStack = [
    { name: 'Python', logo: 'https://cdn.svgporn.com/logos/python.svg', proficiency: 'Expert' },
    { name: 'Java', logo: 'https://cdn.svgporn.com/logos/java.svg', proficiency: 'Advanced' },
    { name: 'C', logo: 'https://cdn.svgporn.com/logos/c.svg', proficiency: 'Intermediate' },
    { name: 'C#', logo: 'https://cdn.svgporn.com/logos/c-sharp.svg', proficiency: 'Beginner' },
    { name: 'HTML', logo: 'https://cdn.svgporn.com/logos/html-5.svg', proficiency: 'Expert' },
    { name: 'CSS', logo: 'https://cdn.svgporn.com/logos/css-3.svg', proficiency: 'Expert' },
    { name: 'JavaScript', logo: 'https://cdn.svgporn.com/logos/javascript.svg', proficiency: 'Advanced' },
    { name: 'LLMs', logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/ollama.png', proficiency: 'Intermediate' },
    { name: 'Weaviate', logo: 'https://d11a6trkgmumsb.cloudfront.net/original/4X/8/1/1/811ef156e2525559c859ecdb7a5cd26d5e459e46.png', proficiency: 'Intermediate' },
    { name: 'Flask', logo: 'https://cdn.svgporn.com/logos/flask.svg', proficiency: 'Expert' },
    { name: 'PyTorch', logo: 'https://cdn.svgporn.com/logos/pytorch-icon.svg', proficiency: 'Intermediate' },
    { name: 'React', logo: 'https://cdn.svgporn.com/logos/react.svg', proficiency: 'Advanced' },
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

  return (
    <section id="tech-stack" className="techstack-section">
      <h2 id="tech">Tech Stack</h2>
      <div className="stack-container">
        {techStack.map((tech, index) => (
          <div key={index} className="tech-card">
            <img src={tech.logo} alt={`${tech.name} logo`} className="tech-logo" />
            
            <div className="tech-details">
              <h3>{tech.name}</h3>
              {/*<p>{tech.proficiency}</p>*/}
            </div>
          </div>
        ))}
      </div>

      <h2 id="tools">Tools</h2>
      <div className="tools-container">
        {tools.map((tool, index) => (
          <div key={index} className="tool-card">
            <img src={tool.logo} alt={`${tool.name} logo`} className="tool-logo" />
            <p>{tool.name}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default TechStack;
