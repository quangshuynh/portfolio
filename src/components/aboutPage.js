import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaArrowRight, FaCamera, FaCar, FaGamepad, FaMapMarkerAlt, FaMountain, FaMusic, FaUsers, FaGithub } from 'react-icons/fa';
import PersonalityButton from './personalityButton';
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
import waterImpact from '../assets/about/photography/impact.jpg';
import rochesterSkyline from '../assets/about/photography/rochester-skyline.jpg';
import trainTracks from '../assets/about/photography/around-the-bend.jpg';
import woodlandStream from '../assets/about/photography/optimized/woodland-stream-web.jpg';
import koreTeamLunch from '../assets/about/kore/mission-bbq-kore-team-lunch-web.jpg';
import Footer from './footer';
import SiteNav, { homeHref } from './siteNav';
import { ImageTrigger, InterestCard, InterestGalleryModal, PhotoLightbox } from './aboutGallery';

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
    'I enjoy understanding how hardware works, from building and upgrading PCs to learning what is happening under the hood of a car.'
  ],
  [
    FaGamepad,
    'Gaming',
    'I like games that reward exploration, strategy, progression, and building things over time.'
  ],
  [
    FaUsers,
    'Time with family & friends',
    'Spending time with family and friends is an important part of my life, especially over a meal, a game, or a shared activity.'
  ]
];

const interestPhotos = {
  Photography: [{ src: photographySunset, width: 1200, height: 1500, alt: 'Golden sunset clouds reflected across waves at the edge of a lake' }],
  Hiking: [{ src: hikingOverlook, width: 1600, height: 1150, alt: 'Quang standing with arms outstretched at a scenic lake overlook' }],
  Music: [{ src: musicPhoto, width: 1200, height: 1600, alt: 'Quang playing guitar' }],
  'Cars & technology': [{ src: carsPhoto, width: 1400, height: 933, alt: 'A blue classic sports car displayed behind a fence' }],
  Gaming: [{ src: minecraftWorld, width: 1600, height: 861, alt: 'A detailed Minecraft survival world with a castle, village, farms, and modern buildings at sunset' }],
  'Time with family & friends': [{ src: familyPhoto, width: 1400, height: 1050, alt: 'Family gathering during a visit to Vietnam' }]
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
  { src: architectureSpire, width: 933, height: 1400, alt: 'A church spire rising between brick buildings at Cornell', caption: "Looking up through Cornell's brick architecture", shape: 'portrait' },
  { src: birdOnLawn, width: 933, height: 1400, alt: 'A small bird standing in vivid green grass at Cornell', caption: 'A quiet moment on the grass at Cornell', shape: 'portrait' },
  { src: libraryReadingRoom, width: 1400, height: 933, alt: 'Warm reading lamps glowing inside the wood-paneled Rush Rhees Library', caption: 'Warm light inside Rush Rhees Library', shape: 'landscape' },
  { src: blueCactusSign, width: 1400, height: 933, alt: 'A colorful Blue Cactus sign on a brick street at the University of Rochester', caption: 'A little color at the University of Rochester', shape: 'landscape' },
  { src: riversideBridge, width: 1050, height: 1400, alt: 'A red metal bridge crossing the Genesee River', caption: 'Red steel bridge over the Genesee River', shape: 'portrait' },
  { src: horizonSunset, width: 1050, height: 1400, alt: 'The sun meeting a dark lake at the horizon', caption: 'Watching the last light disappear over the water', shape: 'portrait' },
  { src: riversideWaterfall, width: 1400, height: 1050, alt: 'A broad waterfall surrounded by summer greenery at Rochester Lower Falls', caption: 'Rochester Lower Falls overlook', shape: 'landscape' },
  { src: lakesideSunset, width: 1400, height: 1050, alt: 'Pink sunset clouds above a calm lakeshore in Irondequoit Bay', caption: 'Pastel skies over Irondequoit Bay', shape: 'landscape' },
  { src: niagaraOverlook, width: 1050, height: 1400, alt: 'A distant city skyline beyond a misty waterfall at Niagara Falls', caption: 'Mist and skyline at Niagara Falls', shape: 'portrait' },
  { src: forestCanopy, width: 927, height: 1400, alt: 'Looking upward through a dense green forest canopy at Bristol Mountain', caption: 'Looking up through the trees at Bristol Mountain', shape: 'portrait' },
  { src: waterfallCliffs, width: 927, height: 1400, alt: 'Layered waterfalls flowing over a rocky cliff in Ithaca', caption: 'Ithaca Falls in the summer', shape: 'portrait' },
  { src: woodlandStream, width: 933, height: 1400, alt: 'A narrow stream winding through a sunlit woodland at Cornell', caption: 'Following a stream through the woods at Cornell', shape: 'portrait' },
  { src: historicBuilding, width: 1400, height: 933, alt: 'Rush Rhees Library framed by bare winter branches', caption: 'Rush Rhees Library through bare winter branches', shape: 'landscape' },
  { src: waterImpact, width: 1400, height: 1050, alt: 'A splash of water frozen in midair', caption: 'Capturing the moment of impact at Webster Park', shape: 'landscape' },
  { src: hilltopCastle, width: 933, height: 1400, alt: 'A stone building overlooking a wide valley at Cornell', caption: 'Looking out from Cornell stone architecture', shape: 'portrait' },
  { src: trainTracks, width: 1400, height: 1050, alt: 'Train tracks curving around a bend in the distance', caption: 'Train tracks curving around a bend', shape: 'portrait' },
  { src: rochesterSkyline, width: 1400, height: 1050, alt: 'Rochester skyline at night', caption: 'Rochester skyline at night', shape: 'landscape' },
  { src: whiteCarAtNight, width: 1400, height: 1050, alt: '2011 Subaru WRX at night', caption: 'My 2011 Subaru WRX after dark', shape: 'landscape' }
];

const personalGallery = [
  { src: quangBeachSunset, width: 927, height: 1400, alt: 'Quang standing at the shoreline at sunset', caption: 'Sunset at Charlotte Beach', shape: 'portrait' },
  { src: quangArtSpace, width: 927, height: 1400, alt: 'Quang seated on a large illuminated sphere in a modern interior', caption: 'Exploring Cornell architecture', shape: 'portrait' },
  { src: quangWaterfront, width: 933, height: 1400, alt: 'Quang standing beside a wide body of water at dusk', caption: 'An evening at Webster Park', shape: 'portrait' }
];

const technologyGallery = [
  { src: techPhoto, width: 1050, height: 1400, alt: 'Computer hardware and a custom desktop PC during a hands-on build', caption: 'Building a PC from the ground up', shape: 'portrait' },
  { src: customPcGreen, width: 1050, height: 1400, alt: 'A custom desktop PC illuminated by green lighting', caption: 'My finished RTX 4070 Ti build', shape: 'portrait' },
  { src: graphicsCard, width: 1050, height: 1400, alt: 'An RTX 3080 Ti graphics card held above a work surface', caption: 'Getting an RTX 3080 Ti Founders Edition ready for its next build', shape: 'portrait' },
  { src: carShowPorsche, width: 1400, height: 984, alt: 'A black Singer Porsche 930 displayed at Little Speed Shop Cars & Coffee', caption: 'A Singer Porsche 930 at The Little Speed Shop Cars & Coffee', shape: 'landscape' },
  { src: carShowSubaruEngine, width: 1400, height: 889, alt: 'Modified blue Blobeye STI with its engine bay open at a car show', caption: 'Taking a closer look under the hood of this Blobeye STI', shape: 'landscape' }
];

const gamingGallery = [
  { src: csgoScreenshot, width: 1152, height: 864, alt: 'Counter-Strike: Global Offensive menu screenshot', caption: 'CS:GO, 2022', shape: 'landscape' }
];

const familyGallery = [
  { src: familyPhoto, width: 1400, height: 1050, alt: 'Family gathering during a visit to Vietnam', caption: 'Visiting family in Vietnam, 2023', shape: 'landscape' },
];

const galleries = { personal: personalGallery, photography: photographyGallery, technology: technologyGallery, gaming: gamingGallery, family: familyGallery };
const interestGalleryKeys = { Photography: 'photography', Music: 'music', 'Cars & technology': 'technology', Gaming: 'gaming', 'Time with family & friends': 'family' };

function AboutPage() {
  const [activeGallery, setActiveGallery] = useState(null);
  const [directLightbox, setDirectLightbox] = useState(null);
  const galleryTrigger = useRef(null);
  const lightboxTrigger = useRef(null);

  const openGallery = useCallback((gallery, trigger) => {
    galleryTrigger.current = trigger;
    setActiveGallery(gallery);
  }, []);

  const closeGallery = useCallback(() => {
    setActiveGallery(null);
    requestAnimationFrame(() => galleryTrigger.current?.focus());
  }, []);

  const openDirectLightbox = useCallback((image, trigger) => {
    lightboxTrigger.current = trigger;
    setDirectLightbox(image);
  }, []);

  const closeDirectLightbox = useCallback(() => {
    setDirectLightbox(null);
    requestAnimationFrame(() => lightboxTrigger.current?.focus());
  }, []);

  useEffect(() => {
    if (!directLightbox) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [directLightbox]);

  return (
    <div className="app-shell about-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header><SiteNav /></header>
      <main id="main-content">
        <section className="about-hero scroll-panel section-reveal" aria-labelledby="about-page-title">
          <div className="section-inner about-hero-grid reveal-content">
            <div>
              <p className="eyebrow">A little more about me</p>
              <h1 id="about-page-title">Hi, I’m Quang.</h1>
              <p className="about-location"><FaMapMarkerAlt aria-hidden="true" /> Rochester, New York</p>
              <div className="about-prose">
                <p>
                  I’m a software developer and computer science student. I was born in Vietnam
                  and moved to the United States with my family when I was young. Rochester has
                  been home for most of my life.
                </p>

                <p>
                  Games and computer hardware were what first pulled me toward computers.
                  Growing up, I experimented with Minecraft mods and servers, rooted and
                  jailbroken devices, and generally tried to understand how the software
                  around me worked. That curiosity eventually turned into wanting to build
                  software of my own.
                </p>

                <p>
                  Over time, I became especially interested in problems where the interesting part
                  is not just making something work, but figuring out what happens when assumptions
                  fail, data gets messy, or software has to keep working over time.
                </p>
              </div>
              <div className="hero-actions">
                <PersonalityButton href={homeHref('#projects')} personality="hardware" personalityKey="about-view-work">View my work <FaArrowRight aria-hidden="true" /></PersonalityButton>
                <PersonalityButton secondary href={homeHref('#contact')} personality="auto" personalityKey="about-contact">Get in touch</PersonalityButton>
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

        <section className="page-section about-path scroll-panel section-reveal" aria-labelledby="path-title">
          <div className="section-inner about-story reveal-content">
            <div className="about-story-intro">
              <p className="eyebrow">My path into software</p>
              <h2 id="path-title">From coursework to production software</h2>

              <figure className="kore-team-photo">
                <ImageTrigger className="kore-team-photo-button" label="Open KORE Wireless team lunch photo" onOpen={(trigger) => openDirectLightbox({ src: koreTeamLunch, alt: 'Quang seated at lunch with members of the KORE Wireless engineering team', caption: 'Team lunch near the end of my software engineering co-op at KORE Wireless' }, trigger)}>
                  <img src={koreTeamLunch} alt="Quang seated at lunch with members of the KORE Wireless engineering team" loading="lazy" />
                </ImageTrigger>
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

              <p>
                I have since designed, built, deployed, and maintained production web applications
                for family-owned Rochester businesses, alongside my native Apple, backend, and
                open-source engineering work.
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

        <section className="page-section about-beyond scroll-panel section-reveal" aria-labelledby="beyond-title">
          <div className="section-inner reveal-content">
            <div className="section-heading"><div><p className="eyebrow">Outside the editor</p><h2 id="beyond-title">Beyond software</h2></div><p>A few of the things I make time for away from work and school.</p></div>
            <div className="interest-grid">
              {interests.map(([Icon, title, copy]) => (
                <InterestCard
                  key={title}
                  icon={Icon}
                  title={title}
                  copy={copy}
                  photos={interestPhotos[title]}
                  gallery={interestGalleryKeys[title]}
                  galleryItems={galleries[interestGalleryKeys[title]]}
                  hasNonPhotoContent={interestGalleryKeys[title] === 'music'}
                  onOpen={openGallery}
                  onOpenImage={(image, trigger) => openDirectLightbox({ src: image.src, alt: image.alt, caption: image.caption ?? title }, trigger)}
                />
              ))}
            </div>
            {activeGallery && (
              <InterestGalleryModal
                activeGallery={activeGallery}
                galleries={galleries}
                onClose={closeGallery}
              />
            )}
          </div>
        </section>

        <section className="page-section about-values scroll-panel section-reveal" aria-labelledby="values-title">
          <div className="section-inner reveal-content">
            <div className="section-heading"><div><p className="eyebrow">How I like to work</p><h2 id="values-title">How I approach engineering</h2></div><p>Three principles I return to when I’m learning, building, and collaborating.</p></div>
            <div className="values-grid">{values.map(([title, copy], index) => <article className="value-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
            <p className="education-note">
              I’m currently pursuing an accelerated BS/MS in Computer Science at RIT,
              with particular interest in systems, databases, algorithms, and the
              engineering decisions behind dependable software.
            </p>
          </div>
        </section>

        <section className="about-cta scroll-panel section-reveal" aria-labelledby="about-cta-title">
          <div className="section-inner reveal-content">
            <p className="eyebrow">Selected work</p>
            <h2 id="about-cta-title">Want to see what I’ve been building?</h2>
            <div className="hero-actions">
              <PersonalityButton href={homeHref('#projects')} personality="auto" personalityKey="about-view-projects">View projects <FaArrowRight aria-hidden="true" /></PersonalityButton>
              <a className="button button-secondary" href="https://github.com/quangshuynh" target="_blank" rel="noreferrer"><FaGithub aria-hidden="true" /> GitHub</a>
            </div>
          </div>
        </section>
      </main>
      {directLightbox && <PhotoLightbox image={directLightbox} onClose={closeDirectLightbox} />}
      <Footer />
    </div>
  );
}

export default AboutPage;
