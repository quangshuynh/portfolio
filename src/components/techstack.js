import React from 'react';
import '../styles/techstack.css';

function TechStack() {
  // https://svglogos.dev/ (for logos)
  const languages = [
    { name: 'Python', logo: 'https://cdn.svgporn.com/logos/python.svg', link: 'https://www.python.org' },
    { name: 'HTML', logo: 'https://cdn.svgporn.com/logos/html-5.svg', link: 'https://developer.mozilla.org/en-US/docs/Web/HTML' },
    { name: 'CSS', logo: 'https://cdn.svgporn.com/logos/css-3.svg', link: 'https://developer.mozilla.org/en-US/docs/Web/CSS' },
    { name: 'Java', logo: 'https://cdn.svgporn.com/logos/java.svg', link: 'https://www.java.com/en/' },
    { name: 'JavaScript', logo: 'https://cdn.svgporn.com/logos/javascript.svg', link: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript' },
    { name: 'C', logo: 'https://cdn.svgporn.com/logos/c.svg', link: 'https://en.wikipedia.org/wiki/C_(programming_language)' },
    { name: 'C#', logo: 'https://cdn.svgporn.com/logos/c-sharp.svg', link: 'https://docs.microsoft.com/en-us/dotnet/csharp/' },
    { name: 'SQL', logo: 'https://i.imgur.com/0cgPCGd.png', link: 'https://en.wikipedia.org/wiki/SQL' },
    { name: 'Visual Basic', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/VB.NET_Logo.svg/1280px-VB.NET_Logo.svg.png', link: 'https://en.wikipedia.org/wiki/Visual_Basic_(.NET)'}
  ];

  const frameworks = [
    { name: 'Flask', logo: 'https://cdn.svgporn.com/logos/flask.svg', link: 'https://flask.palletsprojects.com/' },
    { name: 'React.js', logo: 'https://cdn.svgporn.com/logos/react.svg', link: 'https://react.dev/' },
    { name: 'Node.js', logo: 'https://cdn.svgporn.com/logos/nodejs-icon.svg', link: 'https://nodejs.org/en'},
    { name: 'JavaFX', logo: 'https://cdn.svgporn.com/logos/java.svg', link: 'https://openjfx.io' },
    { name: 'Tkinter', logo: 'https://i.imgur.com/g6am5XO.png', link: 'https://docs.python.org/3/library/tkinter.html' },
    { name: 'PyTorch', logo: 'https://cdn.svgporn.com/logos/pytorch-icon.svg', link: 'https://pytorch.org' },
    { name: 'LLMs', logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/ollama.png', link: 'https://ollama.ai' },
    { name: 'Weaviate', logo: 'https://d11a6trkgmumsb.cloudfront.net/original/4X/8/1/1/811ef156e2525559c859ecdb7a5cd26d5e459e46.png', link: 'https://weaviate.io' },
    { name: 'NumPy', logo: 'https://cdn.svgporn.com/logos/numpy.svg', link: 'https://numpy.org' },
    { name: 'Pandas', logo: 'https://cdn.svgporn.com/logos/pandas-icon.svg', link: 'https://pandas.pydata.org' },
    { name: 'Matplotlib', logo: 'https://cdn.svgporn.com/logos/matplotlib.svg', link: 'https://matplotlib.org' },
    { name: 'Computer Vision', logo: 'https://cdn.svgporn.com/logos/opencv.svg', link: 'https://opencv.org' },
  ];

  const tools = [
    { name: 'Git', logo: 'https://cdn.svgporn.com/logos/git-icon.svg', link: 'https://git-scm.com' },
    { name: 'Linux', logo: 'https://cdn.svgporn.com/logos/linux-tux.svg', link: 'https://www.kernel.org' },
    { name: 'Visual Studio Code', logo: 'https://cdn.svgporn.com/logos/visual-studio-code.svg', link: 'https://code.visualstudio.com' },
    { name: 'Visual Studio', logo: 'https://cdn.svgporn.com/logos/visual-studio.svg', link: 'https://visualstudio.microsoft.com' },
    { name: 'PyCharm', logo: 'https://cdn.svgporn.com/logos/pycharm.svg', link: 'https://www.jetbrains.com/pycharm/' },
    { name: 'IntelliJ', logo: 'https://cdn.svgporn.com/logos/intellij-idea.svg', link: 'https://www.jetbrains.com/idea/' },
    { name: 'SQL Server Management Studio', logo: 'https://i.imgur.com/lWJDvnV.png', link: 'https://learn.microsoft.com/en-us/sql/ssms/sql-server-management-studio-ssms' },
    { name: 'Replit', logo: 'https://cdn.svgporn.com/logos/replit-icon.svg', link: 'https://replit.com' },
    { name: 'MobaXterm', logo: 'https://onion.io/wp-content/uploads/2017/11/Moba-Logo.jpg', link: 'https://mobaxterm.mobatek.net' },
  ];

  // wraps the image in an <a> tag if a link is provided
  const renderCards = (items) =>
    items.map((item, index) => (
      <div key={index} className="tech-card">
        {item.link ? (
          <a href={item.link} target="_blank" rel="noopener noreferrer">
            <img src={item.logo} alt={`${item.name} logo`} className="tech-logo" />
          </a>
        ) : (
          <img src={item.logo} alt={`${item.name} logo`} className="tech-logo" />
        )}
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
