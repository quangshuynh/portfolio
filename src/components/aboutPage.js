import React, { useCallback, useRef, useState } from 'react';
import { FaArrowRight, FaCamera, FaCar, FaGamepad, FaMapMarkerAlt, FaMountain, FaMusic, FaUsers, FaGithub } from 'react-icons/fa';
import quangPhoto from '../assets/about/quang/quang-about-portrait-web.jpg';
import photographySunset from '../assets/about/photography/quang-photography-sunset-web.jpg';
import hikingOverlook from '../assets/about/hiking/quang-hiking-overlook-web.jpg';
import minecraftWorld from '../assets/about/gaming/quang-minecraft-survival-world-web.jpg';
import csgoScreenshot from '../assets/about/gaming/csgo-web.jpg';
import carsPhoto from '../assets/about/cars-tech/quang-cars-web.jpg';
import techPhoto from '../assets/about/cars-tech/quang-tech-web.jpg';
import carShowPorsche from '../assets/about/cars-tech/car-show-porsche-web.jpg';
import carShowSubaruEngine from '../assets/about/cars-tech/car-show-subaru-engine-web.jpg';
import customPcGreen from '../assets/about/cars-tech/custom-pc-green-web.jpg';
import graphicsCard from '../assets/about/cars-tech/graphics-card-rtx-3080-ti-web.jpg';
import quangBeachSunset from '../assets/about/quang/quang-beach-sunset-web.jpg';
import quangArtSpace from '../assets/about/quang/quang-art-space-web.jpg';
import quangWaterfront from '../assets/about/quang/quang-waterfront-web.jpg';
import musicPhoto from '../assets/about/music/quang-guitar-web.jpg';
import familyPhoto from '../assets/about/family/vietnam2023-web.jpg';
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
import koreTeamLunch from '../assets/about/kore/mission-bbq-kore-team-lunch-web.jpg';
import Footer from './footer';
import SiteNav, { homeHref } from './siteNav';
import { InterestCard, InterestGalleryModal } from './aboutGallery';

const interests = [
  [
    FaCamera,
    'Photography',
    'Photography gives me room to experiment with how composition, lighting, and perspective shape an image.'
  ],
  [
    FaMountain,
    'Hiking',
    'Getting outside, exploring new places, and taking a break from screens helps me recharge.'
  ],
  [
    FaMusic,
    'Music',
    'I like listening to music, discovering new artists, and playing guitar recreationally.'
  ],
  [
    FaCar,
    'Cars & technology',
    'I enjoy learning how things are put together, whether that means working on computer hardware, exploring new technology, or looking under the hood of a car.'
  ],
  [
    FaGamepad,
    'Gaming',
    'Gaming is one of the ways I relax and was also part of what originally made computers interesting to me.'
  ],
  [
    FaUsers,
    'Time with family & friends',
    'Spending time with family and friends is an important part of my life, especially over a meal, a game, or a shared activity.'
  ]
];

const interestPhotos = {
  Photography: [[photographySunset, 1200, 1500, 'Golden sunset clouds reflected across waves at the edge of a lake']],
  Hiking: [[hikingOverlook, 1600, 1150, 'Quang standing with arms outstretched at a scenic lake overlook']],
  Music: [[musicPhoto, 1200, 1600, 'Quang playing guitar']],
  'Cars & technology': [[carsPhoto, 1400, 933, 'A blue classic sports car displayed behind a fence']],
  Gaming: [[minecraftWorld, 1600, 861, 'A detailed Minecraft survival world with a castle, village, farms, and modern buildings at sunset']],
  'Time with family & friends': [[familyPhoto, 1400, 1050, 'Family gathering during a visit to Vietnam']]
};

const values = [
  [
    'Curiosity',
    'I like understanding why a system behaves the way it does, especially when the obvious explanation is incomplete.'
  ],
  [
    'Reliability',
    'I care about software that behaves predictably, handles failure intentionally, and stays understandable over time.'
  ],
  [
    'Usefulness',
    'I like taking ideas beyond prototypes and turning them into practical tools someone could genuinely rely on.'
  ]
];

const photographyGallery = [
  [architectureSpire, 933, 1400, 'A church spire rising between brick buildings at Cornell', 'portrait'],
  [birdOnLawn, 933, 1400, 'A small bird standing in vivid green grass at Cornell', 'portrait'],
  [libraryReadingRoom, 1400, 933, 'Warm reading lamps glowing inside the wood-paneled Rush Rhees Library'],
  [riversideBridge, 1050, 1400, 'A red metal bridge crossing the Genesee River', 'portrait'],
  [horizonSunset, 1050, 1400, 'The sun meeting a dark lake at the horizon', 'portrait'],
  [riversideWaterfall, 1400, 1050, 'A broad waterfall surrounded by summer greenery at Rochester Lower Falls'],
  [lakesideSunset, 1400, 1050, 'Pink sunset clouds above a calm lakeshore in Irondequoit Bay'],
  [niagaraOverlook, 1050, 1400, 'A distant city skyline beyond a misty waterfall at Niagara Falls', 'portrait'],
  [forestCanopy, 927, 1400, 'Looking upward through a dense green forest canopy at Bristol Mountain', 'portrait'],
  [waterfallCliffs, 927, 1400, 'Layered waterfalls flowing over a rocky cliff in Ithaca', 'portrait'],
  [woodlandStream, 933, 1400, 'A narrow stream winding through a sunlit woodland at Cornell', 'portrait'],
  [historicBuilding, 1400, 933, 'Rush Rhees Library framed by bare winter branches'],
  [hilltopCastle, 933, 1400, 'A stone building overlooking a wide valley at Cornell', 'portrait'],
  [blueCactusSign, 1400, 933, 'A colorful Blue Cactus sign on a brick street at the University of Rochester'],
  [woodlandFence, 1400, 1050, 'A wooden fence bordering a green woodland'],
  [whiteCarAtNight, 1400, 1050, '2011 Subaru WRX at night']
];

const photographyCaptions = {
  [architectureSpire]: 'Looking up through Cornell’s brick architecture',
  [birdOnLawn]: 'A quiet moment on the grass at Cornell',
  [libraryReadingRoom]: 'Warm light inside Rush Rhees Library',
  [riversideBridge]: 'Red steel bridge over the Genesee River',
  [horizonSunset]: 'Watching the last light disappear over the water',
  [riversideWaterfall]: 'Rochester Lower Falls overlook',
  [lakesideSunset]: 'Pastel skies over Irondequoit Bay',
  [niagaraOverlook]: 'Mist and skyline at Niagara Falls',
  [forestCanopy]: 'Looking up through the trees at Bristol Mountain',
  [waterfallCliffs]: 'Ithaca Falls in the summer',
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
  [graphicsCard, 1050, 1400, 'An RTX 3080 Ti graphics card held above a work surface', 'Getting an RTX 3080 Ti Founders Edition ready for its next build', 'portrait'],
  [carShowPorsche, 1400, 984, 'A black Singer Porsche 930 displayed at Little Speed Shop Cars & Coffee', 'A Singer Porsche 930 at The Little Speed Shop’s Cars & Coffee'],
  [carShowSubaruEngine, 1400, 889, 'Modified blue Blobeye STI with its engine bay open at a car show', 'Taking a closer look under the hood of this Blobeye STI']
];

const gamingGallery = [
  [csgoScreenshot, 1152, 864, 'Counter-Strike: Global Offensive menu screenshot', 'CS:GO, 2022']
];

const familyGallery = [
  [familyPhoto, 1400, 1050, 'Family gathering during a visit to Vietnam', 'Visiting family in Vietnam, 2023']
];

function AboutPage() {
  const [activeGallery, setActiveGallery] = useState(null);
  const galleryTrigger = useRef(null);

  const openGallery = useCallback((gallery, trigger) => {
    galleryTrigger.current = trigger;
    setActiveGallery(gallery);
  }, []);

  const closeGallery = useCallback(() => {
    setActiveGallery(null);
    requestAnimationFrame(() => galleryTrigger.current?.focus());
  }, []);

  return (
    <div className="app-shell about-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header><SiteNav /></header>
      <main id="main-content">
        <section className="about-hero" aria-labelledby="about-page-title">
          <div className="section-inner about-hero-grid">
            <div>
              <p className="eyebrow">A little more about me</p>
              <h1 id="about-page-title">Hi, I’m Quang.</h1>
              <p className="about-location"><FaMapMarkerAlt aria-hidden="true" /> Rochester, New York</p>
              <div className="about-prose">
                <p>
                  I’m a software developer and Computer Science student. I was born in Vietnam
                  and moved to the United States with my family when I was young, and Rochester
                  has been home for most of my life.
                </p>

                <p>
                  I became interested in computers through games and hardware, and that curiosity
                  eventually led me into programming. I tend to learn by taking an idea or problem 
                  far enough to encounter the harder engineering questions behind it.
                </p>

                <p>
                  Over time, I became especially interested in problems where the interesting part
                  is not just making something work, but figuring out what happens when assumptions
                  fail, data gets messy, or software has to keep working over time.
                </p>
              </div>
              <div className="hero-actions">
                <a className="button" href={homeHref('#projects')}>View my work <FaArrowRight aria-hidden="true" /></a>
                <a className="button button-secondary" href={homeHref('#contact')}>Get in touch</a>
              </div>
            </div>
            <figure className="about-portrait">
              <button className="about-portrait-button" type="button" aria-label="View more photos of Quang" aria-haspopup="dialog" onClick={(event) => openGallery('personal', event.currentTarget)}>
                <img src={quangPhoto} width="1000" height="1000" alt="Quang seated on a bench outdoors" />
                <span>View photos</span>
              </button>
            </figure>
          </div>
        </section>

        <section className="page-section" aria-labelledby="path-title">
          <div className="section-inner about-story">
            <div className="about-story-intro">
              <p className="eyebrow">My path into software</p>
              <h2 id="path-title">From coursework to production software</h2>

              <figure className="kore-team-photo">
                <img
                  src={koreTeamLunch}
                  alt="Quang with members of the KORE Wireless engineering team"
                  loading="lazy"
                />
                <figcaption>
                  Team lunch near the end of my software engineering co-op at KORE Wireless
                </figcaption>
              </figure>
            </div>
            <div className="about-prose">
              <p>
                My first professional software engineering role was at KORE Wireless through
                RIT’s co-op program. It was my first opportunity to move beyond coursework and
                contribute to software used in real business operations.
              </p>

              <p>
                During the co-op, I learned an unfamiliar enterprise codebase and integration 
                environment while contributing across application code, SQL, integrations, testing, 
                and production issue investigation.
              </p>

              <p>
                That experience changed how I approach my own projects. I became much more interested in 
                reliability, failure handling, data correctness, and what happens outside the happy path.
              </p>

              <blockquote className="about-quote">
                <p>“He was able to work with greater independence than is expected of co-ops.”</p>
                <footer>
                  <cite>Matt Telesky, Director of Software Engineering</cite>
                </footer>
              </blockquote>
            </div>
          </div>
        </section>

        <section className="page-section" aria-labelledby="beyond-title">
          <div className="section-inner">
            <div className="section-heading"><div><p className="eyebrow">Outside the editor</p><h2 id="beyond-title">Beyond software</h2></div><p>A few of the things I make time for away from work and school.</p></div>
            <div className="interest-grid">
              {interests.map(([Icon, title, copy]) => (
                <InterestCard
                  key={title}
                  icon={Icon}
                  title={title}
                  copy={copy}
                  photos={interestPhotos[title]}
                  onOpen={openGallery}
                />
              ))}
            </div>
            {activeGallery && (
              <InterestGalleryModal
                activeGallery={activeGallery}
                galleries={{
                  personal: personalGallery,
                  photography: photographyGallery,
                  technology: technologyGallery,
                  gaming: gamingGallery,
                  family: familyGallery
                }}
                photographyCaptions={photographyCaptions}
                onClose={closeGallery}
              />
            )}
          </div>
        </section>

        <section className="page-section" aria-labelledby="values-title">
          <div className="section-inner">
            <div className="section-heading"><div><p className="eyebrow">How I like to work</p><h2 id="values-title">What guides my work</h2></div><p>Three principles I return to when I’m learning, building, and collaborating.</p></div>
            <div className="values-grid">{values.map(([title, copy], index) => <article className="value-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
            <p className="education-note">
              I’m currently pursuing an accelerated BS/MS in Computer Science at RIT,
              with particular interest in systems, databases, algorithms, and the
              engineering decisions behind dependable software.
            </p>
          </div>
        </section>

        <section className="about-cta" aria-labelledby="about-cta-title">
          <div className="section-inner">
            <p className="eyebrow">Selected work</p>
            <h2 id="about-cta-title">Want to see what I’ve been building?</h2>
            <div className="hero-actions">
              <a className="button" href={homeHref('#projects')}>View projects <FaArrowRight aria-hidden="true" /></a>
              <a className="button button-secondary" href="https://github.com/quangshuynh" target="_blank" rel="noreferrer"><FaGithub aria-hidden="true" /> GitHub</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default AboutPage;
