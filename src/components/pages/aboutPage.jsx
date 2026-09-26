import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { FaArrowRight, FaCamera, FaCar, FaDesktop, FaGamepad, FaMapMarkerAlt, FaMountain, FaMusic, FaGithub } from 'react-icons/fa';
import PersonalityButton from '../ui/personalityButton';
import quangPhoto from '../../assets/about/quang/quang-about-portrait-web.jpg';
import photographySunset from '../../assets/about/photography/quang-photography-sunset-web.jpg';
import hikingOverlook from '../../assets/about/hiking/quang-hiking-overlook-web.jpg';
import hikingDuskOverlook from '../../assets/about/hiking/hiking-dusk-overlook.jpg';
import frozenWaterfall from '../../assets/about/hiking/frozen-waterfall-2026.jpg';
import minecraftWorld from '../../assets/about/gaming/quang-minecraft-survival-world-web.jpg';
import csgoScreenshot from '../../assets/about/gaming/csgo-web.jpg';
import fortniteLifetimeStats from '../../assets/about/gaming/fortnite-lifetime-stats.png';
import marvelRivalsMvpStats from '../../assets/about/gaming/marvel-rivals-mvp-stats.png';
import minecraftCherryHouse from '../../assets/about/gaming/minecraft-cherry-house.jpg';
import simRacingSetup from '../../assets/about/gaming/sim-racing-setup-2024.jpg';
import carsPhoto from '../../assets/about/cars-tech/quang-cars-web.jpg';
import techPhoto from '../../assets/about/cars-tech/quang-tech-web.jpg';
import carShowPorsche from '../../assets/about/cars-tech/car-show-porsche-web.jpg';
import carShowSubaruEngine from '../../assets/about/cars-tech/car-show-subaru-engine-web.jpg';
import customPcGreen from '../../assets/about/cars-tech/custom-pc-green-web.jpg';
import graphicsCard from '../../assets/about/cars-tech/graphics-card-rtx-3080-ti-web.jpg';
import subaruWaterfront from '../../assets/about/cars-tech/subaru-25rs-waterfront.jpg';
import subaruEngineBay from '../../assets/about/cars-tech/subaru-25rs-engine-bay.jpg';
import technologyWorkstation from '../../assets/about/cars-tech/technology-workstation.jpg';
import motherboardUpgrade from '../../assets/about/cars-tech/motherboard-upgrade-2024.jpg';
import roomSetup2025 from '../../assets/about/cars-tech/room-setup-2025.jpg';
import quangBeachSunset from '../../assets/about/quang/quang-beach-sunset-web.jpg';
import quangArtSpace from '../../assets/about/quang/quang-art-space-web.jpg';
import quangWaterfront from '../../assets/about/quang/quang-waterfront-web.jpg';
import musicPhoto from '../../assets/about/music/quang-guitar-web.jpg';
import koreTeamLunch from '../../assets/about/kore/mission-bbq-kore-team-lunch-web.jpg';
import Footer from '../sections/footer';
import SiteNav, { homeHref } from '../sections/siteNav';
import { ImageTrigger, InterestCard, InterestGalleryModal } from '../about/aboutGallery';
import PhotoLightbox from '../ui/photoLightbox';
import { photographs } from '../../data/photographs';
import { appHref, navigate } from '../../util/navigation';
import SpotifyDisc from '../ui/spotifyDisc';
import { TopoField } from '../ui/terrain';

const interestTags = { Photography: 'Lens', Hiking: 'Trail', Music: 'On repeat', Cars: 'Garage', Gaming: 'Play', Technology: 'Bench' };

const currently = [
  ['Studying', 'Accelerated BS/MS in Computer Science at RIT, graduating 2028'],
  ['Drawn to', 'Systems, databases, algorithms, and the decisions behind dependable software'],
  ['Building', 'Production web apps for Rochester businesses, native Apple tools, and open-source backend work'],
];

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
    'Cars',
    <>
      I enjoy learning how cars work, from understanding what is happening under the hood to maintaining, upgrading, and documenting them. I also keep a{' '}
      <a href="https://gc8quang.vercel.app/" target="_blank" rel="noreferrer">photo archive of my blue Subaru Impreza 2.5RS</a>.
    </>
  ],
  [
    FaGamepad,
    'Gaming',
    'I like games that reward exploration, strategy, progression, and building things over time.'
  ],
  [
    FaDesktop,
    'Technology',
    'I enjoy understanding how technology works beyond the software, from building and upgrading PCs to experimenting with hardware and different devices.'
  ]
];

const interestPhotos = {
  Photography: [{ src: photographySunset, width: 1200, height: 1500, alt: 'Golden sunset clouds reflected across waves at the edge of a lake' }],
  Hiking: [{ src: hikingOverlook, width: 1600, height: 1150, alt: 'Quang standing with arms outstretched at a scenic lake overlook' }],
  Music: [{ src: musicPhoto, width: 1200, height: 1600, alt: 'Quang playing guitar' }],
  Cars: [{ src: carsPhoto, width: 1400, height: 933, alt: 'A blue classic sports car displayed behind a fence' }],
  Gaming: [{ src: minecraftWorld, width: 1600, height: 861, alt: 'A detailed Minecraft survival world with a castle, village, farms, and modern buildings at sunset' }],
  Technology: [{ src: customPcGreen, width: 1050, height: 1400, alt: 'Computer hardware and a custom desktop PC during a hands-on build' }]
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

const personalGallery = [
  { src: quangBeachSunset, width: 927, height: 1400, alt: 'Quang standing at the shoreline at sunset', caption: 'Sunset by the water', shape: 'portrait' },
  { src: quangArtSpace, width: 927, height: 1400, alt: 'Quang seated on a large illuminated sphere in a modern interior', caption: 'Exploring Cornell architecture', shape: 'portrait' },
  { src: quangWaterfront, width: 933, height: 1400, alt: 'Quang standing beside a wide body of water at dusk', caption: 'An evening at Webster Park', shape: 'portrait' }
];

const hikingGallery = [
  { src: frozenWaterfall, width: 1500, height: 2000, alt: 'Frozen waterfall and long icicles in a wooded gorge', caption: 'Frozen falls, 2026', shape: 'portrait' },
  { src: hikingDuskOverlook, width: 1500, height: 2000, alt: 'Dusk settling over a valley and distant city lights from an overlook', caption: 'Staying at the overlook long enough to watch daylight turn into city lights', shape: 'portrait' }
];

const carsGallery = [
  { src: subaruWaterfront, width: 1500, height: 2000, alt: 'Blue Subaru Impreza 2.5RS parked beside the waterfront', caption: 'My Subaru Impreza 2.5RS. One of the reasons cars became more than transportation to me', shape: 'portrait' },
  { src: subaruEngineBay, width: 2000, height: 1500, alt: 'Engine bay of a blue Subaru Impreza 2.5RS during maintenance', caption: 'I enjoy the mechanical side just as much as the photography, learning what is under the hood and keeping an older car going', shape: 'landscape' },
  { src: carShowPorsche, width: 1400, height: 984, alt: 'A black Singer Porsche 930 displayed at Little Speed Shop Cars & Coffee', caption: 'A Singer Porsche 930 at The Little Speed Shop Cars & Coffee', shape: 'landscape' },
  { src: carShowSubaruEngine, width: 1400, height: 889, alt: 'Modified blue Blobeye STI with its engine bay open at a car show', caption: 'Taking a closer look under the hood of this Blobeye STI', shape: 'landscape' }
];

const technologyGallery = [
  { src: roomSetup2025, width: 1500, height: 2000, alt: 'Room setup with dual monitors, a custom desktop PC, and illuminated peripherals', caption: 'Room setup, 2025', shape: 'portrait' },
  { src: techPhoto, width: 1050, height: 1400, alt: 'Computer hardware and a custom desktop PC during a hands-on build', caption: 'Building a PC from the ground up', shape: 'portrait' },
  { src: graphicsCard, width: 1050, height: 1400, alt: 'An RTX 3080 Ti graphics card held above a work surface', caption: 'Getting an RTX 3080 Ti Founders Edition ready for its next build', shape: 'portrait' },
  { src: motherboardUpgrade, width: 1500, height: 2000, alt: 'Desktop motherboard and Intel CPU cooler removed during a computer upgrade', caption: 'Between upgrades, 2024', shape: 'portrait' },
  { src: technologyWorkstation, width: 2000, height: 1500, alt: 'Multi-monitor desktop computer and workstation setup', caption: 'My dorm setup', shape: 'landscape' }
];

const gamingGallery = [
  { src: simRacingSetup, width: 1500, height: 2000, alt: 'Steering wheel, shifter, pedals, and curved monitor arranged for sim racing', caption: 'Sim racing, 2026', shape: 'portrait' },
  { src: minecraftCherryHouse, width: 2000, height: 1084, alt: 'Minecraft house built among cherry trees with a mountain backdrop', caption: 'Cozy Minecraft cabin, 2026', shape: 'landscape' },
  { src: marvelRivalsMvpStats, width: 2000, height: 887, alt: 'Marvel Rivals victory scoreboard showing an MVP performance with 67 KOs', caption: 'Marvel Rivals 67 KOs, 2025', shape: 'landscape' },
  { src: fortniteLifetimeStats, width: 1196, height: 969, alt: 'Fortnite lifetime statistics profile showing wins, matches and eliminations', caption: 'Fortnite, 2023', shape: 'landscape' },
  { src: csgoScreenshot, width: 1152, height: 864, alt: 'Counter-Strike: Global Offensive menu screenshot', caption: 'CS:GO, 2022', shape: 'landscape' }
];

const photographyGallery = [
  ...photographs.map((photograph) => ({ ...photograph, src: photograph.gallerySrc, width: photograph.galleryWidth, height: photograph.galleryHeight }))
];
const galleries = { personal: personalGallery, photography: photographyGallery, hiking: hikingGallery, cars: carsGallery, technology: technologyGallery, gaming: gamingGallery };
const interestGalleryKeys = { Photography: 'photography', Hiking: 'hiking', Music: 'music', Cars: 'cars', Gaming: 'gaming', Technology: 'technology' };

function AboutPage() {
  const [activeGallery, setActiveGallery] = useState(() => {
    if (window.history.state?.restorePhotographyModal) return null;
    if (window.location.hash === '#photography') return 'photography';
    return window.location.hash === '#music' ? 'music' : null;
  });
  const [directLightbox, setDirectLightbox] = useState(null);
  const galleryTrigger = useRef(null);
  const lightboxTrigger = useRef(null);

  useLayoutEffect(() => {
    const shouldRestore = Boolean(window.history.state?.restorePhotographyModal);
    if (!shouldRestore) return;
    const sectionId = window.history.state?.returnSection ?? 'beyond-software';
    // Complete restoration before the modal locks the body. `auto` inherits the
    // document's smooth scrolling, which can continue into a quick View all exit.
    document.getElementById(sectionId)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    setActiveGallery('photography');
  }, []);

  const openGallery = useCallback((gallery, trigger) => {
    galleryTrigger.current = trigger;
    setActiveGallery(gallery);
  }, []);

  const closeGallery = useCallback(() => {
    setActiveGallery(null);
    if (window.location.hash === '#photography' || window.location.hash === '#music') navigate(appHref('/about'), { replace: true });
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

  return (
    <div className="app-shell about-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteNav current="about" />
      <main id="main-content">
        <section className="about-hero" aria-labelledby="about-page-title">
          <TopoField variant="quiet" className="about-hero-topo" />
          <div className="section-inner about-hero-grid">
            <div className="about-hero-copy">
              <p className="eyebrow" style={{ '--i': 0 }}>A little more about me</p>
              <h1 id="about-page-title" style={{ '--i': 1 }}>Hi, I’m Quang.</h1>
              <p className="about-location mono" style={{ '--i': 2 }}><FaMapMarkerAlt aria-hidden="true" /> Rochester, New York, USA <span aria-hidden="true">· 43.16° N 77.61° W</span></p>
              <div className="about-prose" style={{ '--i': 3 }}>
                <p className="about-prose__lead">
                  I’m a software developer and computer science student interested in
                  building dependable, useful software.
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
              <div className="hero-actions" style={{ '--i': 4 }}>
                <PersonalityButton href={homeHref('#projects')} personality="hardware" personalityKey="about-view-work">View my work <FaArrowRight aria-hidden="true" /></PersonalityButton>
                <PersonalityButton secondary href={homeHref('#contact')} personality="auto" personalityKey="about-contact">Get in touch</PersonalityButton>
              </div>
            </div>
            <figure className="about-portrait" style={{ '--i': 2 }}>
              <div className="viewfinder about-portrait-frame">
                <button className="about-portrait-button" type="button" aria-label="View more photos of Quang" aria-haspopup="dialog" onClick={(event) => openGallery('personal', event.currentTarget)}>
                  <img src={quangPhoto} width="1000" height="1000" alt="Quang seated on a bench outdoors" />
                  <span>View more photos</span>
                </button>
              </div>
              <figcaption className="mono">Fig. A — Off the clock, Rochester</figcaption>
            </figure>
          </div>
        </section>

        <section className="page-section about-path" aria-labelledby="path-title">
          <div className="section-inner about-story">
            <div className="about-story-intro" data-reveal>
              <p className="eyebrow"><span className="section-index">01</span> My path into software</p>
              <h2 id="path-title">From coursework to production software</h2>

              <figure className="kore-team-photo viewfinder">
                <ImageTrigger className="kore-team-photo-button" label="Open KORE Wireless team lunch photo" onOpen={(trigger) => openDirectLightbox({ src: koreTeamLunch, alt: 'Quang seated at lunch with members of the KORE Wireless engineering team', caption: 'Team lunch near the end of my software engineering co-op at KORE Wireless' }, trigger)}>
                  <img src={koreTeamLunch} alt="Quang seated at lunch with members of the KORE Wireless engineering team" loading="lazy" />
                </ImageTrigger>
                <figcaption>
                  Team lunch near the end of my software engineering co-op at KORE Wireless
                </figcaption>
              </figure>
            </div>
            <div className="about-prose" data-reveal style={{ '--reveal-delay': '100ms' }}>
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

        <section id="beyond-software" className="page-section about-beyond" aria-labelledby="beyond-title">
          <div className="section-inner">
            <div className="section-heading" data-reveal><div><p className="eyebrow"><span className="section-index">02</span> Outside the editor</p><h2 id="beyond-title">Beyond software</h2></div><p>A few of the things I make time for away from work and school.</p></div>
            <div className="interest-grid">
              {interests.map(([Icon, title, copy], index) => (
                <InterestCard
                  key={title}
                  index={index}
                  tag={interestTags[title]}
                  icon={Icon}
                  title={title}
                  copy={copy}
                  photos={interestPhotos[title]}
                  gallery={interestGalleryKeys[title]}
                  galleryItems={galleries[interestGalleryKeys[title]]}
                  hasNonPhotoContent={interestGalleryKeys[title] === 'music'}
                  onOpen={openGallery}
                  onOpenImage={(image, trigger) => openDirectLightbox({ src: image.src, alt: image.alt, caption: image.caption ?? title }, trigger)}
                  accessory={title === 'Music' ? <SpotifyDisc className="interest-card-disc" onClick={(event) => openGallery('music', event.currentTarget)} /> : null}
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

        <section className="page-section about-values" aria-labelledby="values-title">
          <div className="section-inner">
            <div className="section-heading" data-reveal><div><p className="eyebrow"><span className="section-index">03</span> How I like to work</p><h2 id="values-title">How I approach engineering</h2></div><p>Three principles I return to when I’m learning, building, and collaborating.</p></div>
            <ol className="values-grid">{values.map(([title, copy], index) => <li className="value-card" key={title} data-reveal style={{ '--reveal-delay': `${index * 90}ms` }}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></li>)}</ol>
            <div className="currently" data-reveal>
              <p className="currently__title mono">Currently</p>
              <dl>
                {currently.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </div>
          </div>
        </section>

        <section className="about-cta" aria-labelledby="about-cta-title">
          <div className="section-inner" data-reveal>
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
