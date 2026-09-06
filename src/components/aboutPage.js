import React, { useEffect, useRef, useState } from 'react';
import { FaArrowRight, FaCamera, FaCar, FaGamepad, FaMapMarkerAlt, FaMountain, FaMusic, FaTimes, FaUsers } from 'react-icons/fa';
import quangPhoto from '../assets/about/quang/quang-about-portrait-web.jpg';
import photographySunset from '../assets/about/photography/quang-photography-sunset-web.jpg';
import hikingOverlook from '../assets/about/hiking/quang-hiking-overlook-web.jpg';
import minecraftWorld from '../assets/about/gaming/quang-minecraft-survival-world-web.jpg';
import carsPhoto from '../assets/about/cars-tech/quang-cars-web.jpg';
import techPhoto from '../assets/about/cars-tech/quang-tech-web.jpg';
import carShowPorsche from '../assets/about/cars-tech/car-show-porsche-web.jpg';
import carShowSubaruEngine from '../assets/about/cars-tech/car-show-subaru-engine-web.jpg';
import customPcGreen from '../assets/about/cars-tech/custom-pc-green-web.jpg';
import graphicsCard from '../assets/about/cars-tech/graphics-card-rtx-3080-ti-web.jpg';
import quangBeachSunset from '../assets/about/quang/quang-beach-sunset-web.jpg';
import quangArtSpace from '../assets/about/quang/quang-art-space-web.jpg';
import quangWaterfront from '../assets/about/quang/quang-waterfront-web.jpg';
import architectureSpire from '../assets/about/photography/optimized/architecture-spire-web.jpg';
import birdOnLawn from '../assets/about/photography/optimized/bird-on-lawn-web.jpg';
import blueCactusSign from '../assets/about/photography/optimized/blue-cactus-sign-web.jpg';
import forestCanopy from '../assets/about/photography/optimized/forest-canopy-web.jpg';
import hilltopCastle from '../assets/about/photography/optimized/hilltop-castle-web.jpg';
import historicBuilding from '../assets/about/photography/optimized/historic-building-web.jpg';
import horizonSunset from '../assets/about/photography/optimized/horizon-sunset-web.jpg';
import lakesideSunset from '../assets/about/photography/optimized/lakeside-sunset-web.jpg';
import libraryReadingRoom from '../assets/about/photography/optimized/library-reading-room-web.jpg';
import niagaraOverlook from '../assets/about/photography/optimized/niagara-overlook-web.jpg';
import riversideBridge from '../assets/about/photography/optimized/riverside-bridge-web.jpg';
import riversideWaterfall from '../assets/about/photography/optimized/riverside-waterfall-web.jpg';
import waterfallCliffs from '../assets/about/photography/optimized/waterfall-cliffs-web.jpg';
import whiteCarAtNight from '../assets/about/photography/optimized/white-car-at-night-web.jpg';
import woodlandFence from '../assets/about/photography/optimized/woodland-fence-web.jpg';
import woodlandStream from '../assets/about/photography/optimized/woodland-stream-web.jpg';
import Footer from './footer';
import SiteNav, { homeHref } from './siteNav';

const interests = [
  [FaCamera, 'Photography', 'I enjoy photography and learning how composition, lighting, and equipment affect the final image.'],
  [FaMountain, 'Hiking', 'I enjoy getting outside, exploring new places, and taking a break from screens.'],
  [FaMusic, 'Music', 'I enjoy listening to music, discovering new artists, and playing guitar recreationally.'],
  [FaCar, 'Cars & technology', 'I’ve always been interested in technology beyond computers, including cars and how mechanical and electronic systems work.'],
  [FaGamepad, 'Gaming', 'Gaming is one of the ways I relax and was also part of what originally made computers interesting to me.'],
  [FaUsers, 'Family & friends', 'Spending time with family and friends is an important part of my life. Especially over a meal, a game, or a shared activity.']
];

const interestPhotos = {
  Photography: [[photographySunset, 1200, 1500, 'Golden sunset clouds reflected across waves at the edge of a lake']],
  Hiking: [[hikingOverlook, 1600, 1150, 'Quang standing with arms outstretched at a scenic lake overlook']],
  'Cars & technology': [[carsPhoto, 1400, 933, 'A blue classic sports car displayed behind a fence']],
  Gaming: [[minecraftWorld, 1600, 861, 'A detailed Minecraft survival world with a castle, village, farms, and modern buildings at sunset']]
};

const values = [
  ['Curiosity', 'I like understanding why systems behave the way they do, not just getting them to work once.'],
  ['Reliability', 'I care about software that behaves predictably, handles failure intentionally, and is understandable to maintain.'],
  ['Usefulness', 'I enjoy taking an idea or problem and turning it into something practical that another person could actually use.']
];

const photographyGallery = [
  [architectureSpire, 933, 1400, 'A church spire rising between brick buildings at Cornell', 'portrait'],
  [birdOnLawn, 933, 1400, 'A small bird standing in vivid green grass at Cornell', 'portrait'],
  [libraryReadingRoom, 1400, 933, 'Rush Rhees Library. Warm reading lamps glowing in a wood-paneled library at the University of Rochester'],
  [riversideBridge, 1050, 1400, 'A red metal bridge crossing the Genesee River', 'portrait'],
  [horizonSunset, 1050, 1400, 'The sun meeting a dark lake at the horizon', 'portrait'],
  [riversideWaterfall, 1400, 1050, 'A broad waterfall surrounded by summer greenery at Bristol Mountains'],
  [lakesideSunset, 1400, 1050, 'Pink sunset clouds above a calm lakeshore in Irondequoit Bay'],
  [niagaraOverlook, 1050, 1400, 'A distant city skyline beyond a misty waterfall at Niagara Falls', 'portrait'],
  [forestCanopy, 927, 1400, 'Looking upward through a dense green forest canopy at Bristol Mountains', 'portrait'],
  [waterfallCliffs, 927, 1400, 'Layered waterfalls flowing over a rocky cliff in Ithaca', 'portrait'],
  [woodlandStream, 933, 1400, 'A narrow stream winding through a sunlit woodland at Cornell', 'portrait'],
  [historicBuilding, 1400, 933, 'Rush Rhees Library. An ornate historic building framed by bare branches at the University of Rochester'],
  [hilltopCastle, 933, 1400, 'A stone castle overlooking a wide valley at Cornell', 'portrait'],
  [blueCactusSign, 1400, 933, 'A colorful Blue Cactus sign on a brick street at the University of Rochester'],
  [woodlandFence, 1400, 1050, 'A wooden fence bordering a green woodland'],
  [whiteCarAtNight, 1400, 1050, '2011 Subaru WRX at night']
];

const photographyCaptions = {
  [architectureSpire]: 'Looking up through Cornell’s brick architecture',
  [birdOnLawn]: 'A quiet moment on the grass at Cornell',
  [libraryReadingRoom]: 'Warm light inside Rush Rhees Library',
  [riversideBridge]: 'Red steel over the Genesee River',
  [horizonSunset]: 'Watching the last light disappear over the water',
  [riversideWaterfall]: 'Summer at Bristol Mountain',
  [lakesideSunset]: 'Pastel skies over Irondequoit Bay',
  [niagaraOverlook]: 'Mist and skyline at Niagara Falls',
  [forestCanopy]: 'Looking up through the trees at Bristol Mountain',
  [waterfallCliffs]: 'Water carving through the rock in Ithaca',
  [woodlandStream]: 'Following a stream through the woods at Cornell',
  [historicBuilding]: 'Rush Rhees Library through bare winter branches',
  [hilltopCastle]: 'Looking out from Cornell’s stone architecture',
  [blueCactusSign]: 'A little color near the University of Rochester',
  [woodlandFence]: 'At the edge of the woods in Durand Eastman Park',
  [whiteCarAtNight]: 'My 2011 Subaru WRX after dark'
};

const personalGallery = [
  [quangBeachSunset, 927, 1400, 'Quang standing at the shoreline at sunset', 'Sunset at Charlotte Beach', 'portrait'],
  [quangArtSpace, 927, 1400, 'Quang seated on a large illuminated sphere in a modern interior', 'Exploring Cornell’s architecture', 'portrait'],
  [quangWaterfront, 933, 1400, 'Quang standing beside a wide body of water at dusk', 'An evening at Webster Park', 'portrait']
];

const technologyGallery = [
  [techPhoto, 1050, 1400, 'Computer hardware and a custom desktop PC during a hands-on build', 'Building a PC from the ground up', 'portrait'],
  [customPcGreen, 1050, 1400, 'A custom desktop PC illuminated by green lighting', 'My finished RTX 4070 Ti build', 'portrait'],
  [graphicsCard, 1050, 1400, 'An RTX 3080 Ti graphics card held above a work surface', 'Getting an RTX 3080 Ti ready for an upgrade', 'portrait'],
  [carShowPorsche, 1400, 984, 'A black Singer Porsche 930 displayed at Little Speed Shop Cars  & Coffee', 'A Singer Porsche 930 at The Little Speed Shop’s Cars & Coffee'],
  [carShowSubaruEngine, 1400, 889, 'Modified blue Blobeye STI with its engine bay open at a car show', 'Taking a closer look under the hood of this Blobeye STI']
];

function AboutPage() {
  const [activeGallery, setActiveGallery] = useState(null);
  const [showAllPhotography, setShowAllPhotography] = useState(false);
  const closeGalleryButton = useRef(null);
  const galleryTrigger = useRef(null);

  const openGallery = (gallery, trigger) => {
    galleryTrigger.current = trigger;
    setActiveGallery(gallery);
  };

  const closeGallery = () => {
    setActiveGallery(null);
    setShowAllPhotography(false);
  };

  useEffect(() => {
    if (!activeGallery) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeGalleryButton.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveGallery(null);
        setShowAllPhotography(false);
      }
      if (event.key !== 'Tab') return;

      const modal = closeGalleryButton.current?.closest('.photography-modal');
      const controls = modal?.querySelectorAll('button:not([disabled])');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      galleryTrigger.current?.focus();
    };
  }, [activeGallery]);

  return (
    <div className="app-shell about-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header><SiteNav /></header>
      <main id="main-content">
        <section className="about-hero" aria-labelledby="about-page-title">
          <div className="section-inner about-hero-grid">
            <div>
              <p className="eyebrow">About Quang</p>
              <h1 id="about-page-title">Hi, I’m Quang.</h1>
              <p className="about-location"><FaMapMarkerAlt aria-hidden="true" /> Rochester, New York</p>
              <div className="about-prose">
                <p>I’m a software developer and Computer Science student based in Rochester, New York. I was born in Vietnam and moved to the United States with my family when I was young, and Rochester has been home for most of my life.</p>
                <p>I became interested in computers and technology early on. Over time, that curiosity turned into a goal of becoming a software engineer. I tend to learn by taking an idea or problem and building something from it—usually far enough that I run into the difficult engineering questions that require deeper thinking.</p>
                <p>A lot of my work reflects that. I’ve explored backend reliability, data reconciliation, GitHub APIs, native macOS audio capture, and local-first iOS applications because I wanted to understand how those systems behave beyond the happy path.</p>
              </div>
              <div className="hero-actions">
                <a className="button" href={homeHref('#projects')}>View my work <FaArrowRight aria-hidden="true" /></a>
                <a className="button button-secondary" href={homeHref('#contact')}>Get in touch</a>
              </div>
            </div>
            <figure className="about-portrait">
              <button className="about-portrait-button" type="button" aria-label="View more photos of Quang" aria-haspopup="dialog" onClick={(event) => openGallery('personal', event.currentTarget)}>
                <img src={quangPhoto} width="1000" height="1000" alt="Quang Huynh relaxing on a bench" />
                <span>View photos</span>
              </button>
            </figure>
          </div>
        </section>

        <section className="page-section" aria-labelledby="path-title">
          <div className="section-inner about-story">
            <div><p className="eyebrow">My path into software</p><h2 id="path-title">From the classroom to production.</h2></div>
            <div className="about-prose">
              <p>My first professional software engineering role was at KORE Wireless through RIT’s co-op program. It was the first time I could take what I’d learned in school and apply it to production software used by other people.</p>
              <p>I worked with C#, .NET/WPF, SQL Server, integrations, automation, testing, and production issue investigation. Being trusted with increasingly independent work confirmed that software engineering was the career I wanted to pursue.</p>
              <blockquote className="about-quote"><p>“He was able to work with greater independence than is expected of co-ops.”</p><footer><cite>Matt Telesky, Director of Software Engineering</cite></footer></blockquote>
            </div>
          </div>
        </section>

        <section className="page-section" aria-labelledby="beyond-title">
          <div className="section-inner">
            <div className="section-heading"><div><p className="eyebrow">Outside the editor</p><h2 id="beyond-title">Beyond software</h2></div><p>A few of the things I make time for away from work and school.</p></div>
            <div className="interest-grid">
              {interests.map(([Icon, title, copy]) => {
                const photos = interestPhotos[title];
                return (
                  <article className="interest-card" key={title}>
                    {photos && (
                      <div className={`interest-card-media${photos.length > 1 ? ' interest-card-media-pair' : ''}${title === 'Photography' || title === 'Hiking' ? ' interest-card-media-lowered' : ''}`}>
                        {photos.map(([src, width, height, alt]) => <img src={src} width={width} height={height} alt={alt} key={src} />)}
                      </div>
                    )}
                    <h3><Icon aria-hidden="true" />{title}</h3>
                    <p>{copy}</p>
                    {(title === 'Photography' || title === 'Cars & technology') && (
                      <button className="interest-view-more" type="button" aria-haspopup="dialog" onClick={(event) => openGallery(title === 'Photography' ? 'photography' : 'technology', event.currentTarget)}>View more</button>
                    )}
                  </article>
                );
              })}
            </div>
            {activeGallery && (
              <div className="photography-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeGallery(); }}>
                <section className="photography-modal" role="dialog" aria-modal="true" aria-labelledby="interest-modal-title">
                  <div className="photography-modal-header">
                    <div><p className="eyebrow">{activeGallery === 'photography' ? 'Behind the lens' : activeGallery === 'personal' ? 'Beyond the résumé' : 'Under the hood'}</p><h3 id="interest-modal-title">{activeGallery === 'photography' ? 'Photography by Quang' : activeGallery === 'personal' ? 'More about Quang' : 'Cars & technology'}</h3></div>
                    <button className="photography-modal-close" type="button" onClick={closeGallery} ref={closeGalleryButton} aria-label={`Close ${activeGallery === 'photography' ? 'photography gallery' : activeGallery === 'personal' ? 'personal photo gallery' : 'cars and technology gallery'}`}><FaTimes aria-hidden="true" /></button>
                  </div>
                  {activeGallery === 'personal' ? <div className="photography-gallery personal-gallery" aria-label="More photos of Quang">
                    {personalGallery.map(([src, width, height, alt, caption, shape]) => <figure className={shape === 'portrait' ? 'photography-gallery-portrait' : undefined} key={src}>
                      <img src={src} width={width} height={height} alt={alt} loading="lazy" />
                      <figcaption>{caption}</figcaption>
                    </figure>)}
                  </div> : activeGallery === 'photography' ? <>
                    <div className="photography-gallery" id="photography-gallery" aria-label="More photographs by Quang">
                      {(showAllPhotography ? photographyGallery : photographyGallery.slice(0, 3)).map(([src, width, height, alt, shape]) => (
                        <figure className={shape === 'portrait' ? 'photography-gallery-portrait' : undefined} key={src}>
                          <img src={src} width={width} height={height} alt={alt} loading="lazy" />
                          <figcaption>{photographyCaptions[src]}</figcaption>
                        </figure>
                      ))}
                    </div>
                    {!showAllPhotography && <button className="button photography-view-all" type="button" onClick={() => setShowAllPhotography(true)}>View all</button>}
                  </> : <div className="photography-gallery technology-gallery" aria-label="More cars and technology photos">
                    {technologyGallery.map(([src, width, height, alt, caption, shape]) => <figure className={shape === 'portrait' ? 'photography-gallery-portrait' : undefined} key={src}>
                      <img src={src} width={width} height={height} alt={alt} loading="lazy" />
                      <figcaption>{caption}</figcaption>
                    </figure>)}
                  </div>}
                </section>
              </div>
            )}
          </div>
        </section>

        <section className="page-section" aria-labelledby="values-title">
          <div className="section-inner">
            <div className="section-heading"><div><p className="eyebrow">How I like to work</p><h2 id="values-title">What guides my work</h2></div><p>Three principles I return to when I’m learning, building, and collaborating.</p></div>
            <div className="values-grid">{values.map(([title, copy], index) => <article className="value-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
            <p className="education-note">I’m currently pursuing Computer Science through RIT’s accelerated BS/MS program. My coursework has included algorithms, databases, software engineering, systems, parallel and distributed computing, artificial intelligence, and machine learning, and I especially enjoy applying those concepts through projects.</p>
          </div>
        </section>

        <section className="about-cta" aria-labelledby="about-cta-title"><div className="section-inner"><p className="eyebrow">Selected work</p><h2 id="about-cta-title">Want to see what I’ve been building?</h2><div className="hero-actions"><a className="button" href={homeHref('#projects')}>View projects <FaArrowRight aria-hidden="true" /></a><a className="button button-secondary" href="https://github.com/quangshuynh" target="_blank" rel="noreferrer">GitHub</a></div></div></section>
      </main>
      <Footer />
    </div>
  );
}

export default AboutPage;
