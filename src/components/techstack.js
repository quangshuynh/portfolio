import React from 'react';
import '../styles/techstack.css';

function TechStack() {
  // https://svglogos.dev/ (for logos)
  const languages = [
    { name: 'Python', logo: 'https://cdn.svgporn.com/logos/python.svg'},
    { name: 'HTML', logo: 'https://cdn.svgporn.com/logos/html-5.svg'},
    { name: 'CSS', logo: 'https://cdn.svgporn.com/logos/css-3.svg'},
    { name: 'Java', logo: 'https://cdn.svgporn.com/logos/java.svg'},
    { name: 'JavaScript', logo: 'https://cdn.svgporn.com/logos/javascript.svg'},
    { name: 'C', logo: 'https://cdn.svgporn.com/logos/c.svg'},
    { name: 'C#', logo: 'https://cdn.svgporn.com/logos/c-sharp.svg'},
    { name: 'SQL', logo: 'https://i.imgur.com/0cgPCGd.png'},
  ];
  const frameworks = [
    { name: 'Flask', logo: 'https://cdn.svgporn.com/logos/flask.svg'},
    { name: 'React', logo: 'https://cdn.svgporn.com/logos/react.svg'},
    { name: 'JavaFX', logo: 'https://cdn.svgporn.com/logos/java.svg'},
    { name: 'Tkinter', logo: 'https://i.imgur.com/g6am5XO.png'},
    { name: 'PyTorch', logo: 'https://cdn.svgporn.com/logos/pytorch-icon.svg'},
    { name: 'LLMs', logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/ollama.png'},
    { name: 'Weaviate', logo: 'https://d11a6trkgmumsb.cloudfront.net/original/4X/8/1/1/811ef156e2525559c859ecdb7a5cd26d5e459e46.png'},
    { name: 'NumPy', logo: 'https://cdn.svgporn.com/logos/numpy.svg'},
    { name: 'Pandas', logo: 'https://cdn.svgporn.com/logos/pandas-icon.svg'},
    { name: 'Matplotlib', logo: 'https://cdn.svgporn.com/logos/matplotlib.svg'},
    { name: 'Computer Vision', logo: 'https://cdn.svgporn.com/logos/opencv.svg'},
  ];
  const tools = [
    { name: 'Git', logo: 'https://cdn.svgporn.com/logos/git-icon.svg' },
    { name: 'Linux', logo: 'https://cdn.svgporn.com/logos/linux-tux.svg' },
    { name: 'Visual Studio Code', logo: 'https://cdn.svgporn.com/logos/visual-studio-code.svg' },
    { name: 'Visual Studio', logo: 'https://cdn.svgporn.com/logos/visual-studio.svg' },
    { name: 'PyCharm', logo: 'https://cdn.svgporn.com/logos/pycharm.svg' },
    { name: 'IntelliJ', logo: 'https://cdn.svgporn.com/logos/intellij-idea.svg' },
    { name: 'SQL Server Management Studio', logo: 'https://i.imgur.com/lWJDvnV.png' },
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
