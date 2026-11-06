import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { FaArrowDown, FaArrowRight, FaCamera, FaCar, FaDesktop, FaExternalLinkAlt, FaGamepad, FaImages, FaMapMarkerAlt, FaMountain, FaMusic } from 'react-icons/fa';
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
import carsPhoto from '../../assets/about/cars/quang-cars-web.jpg';
import techPhoto from '../../assets/about/tech/quang-tech-web.jpg';
import carShowPorsche from '../../assets/about/cars/car-show-porsche-web.jpg';
import carShowSubaruEngine from '../../assets/about/cars/car-show-subaru-engine-web.jpg';
import carShowCrowd from '../../assets/about/cars/car-show-crowd-web.jpg';
import nobleM12 from '../../assets/about/cars/noble-m12-web.jpg';
import audiR8 from '../../assets/about/cars/audi-r8-web.jpg';
import toyotaSupraMk3 from '../../assets/about/cars/toyota-supra-mk3-web.jpg';
import customPcGreen from '../../assets/about/tech/custom-pc-green-web.jpg';
import graphicsCard from '../../assets/about/tech/graphics-card-rtx-3080-ti-web.jpg';
import subaru25rs from '../../assets/about/cars/subaru-25rs.jpg';
import subaruEngineBay from '../../assets/about/cars/subaru-25rs-engine-bay.jpg';
import technologyWorkstation from '../../assets/about/tech/technology-workstation.jpg';
import motherboardUpgrade from '../../assets/about/tech/motherboard-upgrade-2024.jpg';
import roomSetup2025 from '../../assets/about/tech/room-setup-2025.jpg';
import quangBeachSunset from '../../assets/about/quang/quang-beach-sunset-web.jpg';
import quangArtSpace from '../../assets/about/quang/quang-art-space-web.jpg';
import quangWaterfront from '../../assets/about/quang/quang-waterfront-web.jpg';
import musicPhoto from '../../assets/about/music/quang-guitar-web.jpg';
import koreTeamLunch from '../../assets/about/kore/mission-bbq-kore-team-lunch-web.jpg';
import Footer from '../sections/footer';
import SiteNav, { homeHref, photographyPageHref } from '../sections/siteNav';
import { galleryEyebrow, ImageTrigger, InterestCard, InterestGalleryModal } from '../about/aboutGallery';
import PhotoLightbox from '../ui/photoLightbox';
import { photographs } from '../../data/photographs';
import { appHref, currentState, navigate } from '../../util/navigation';
import SpotifyDisc from '../ui/spotifyDisc';
import { TopoField } from '../ui/terrain';

const resumeHref = `${import.meta.env.BASE_URL}Quang_Huynh_Resume.pdf`;

const pageIndex = [
  ['path', 'My path'],
  ['beyond-software', 'Beyond software'],
  ['approach', 'How I work'],
  ['currently', 'Currently'],
];

const currently = [
  ['Studying', 'Accelerated BS/MS in Computer Science at RIT, graduating 2028'],
  ['Drawn to', 'Systems, databases, algorithms, and the decisions behind dependable software'],
  ['Building', 'Production web apps for Rochester businesses, native Apple tools, and open-source backend work'],
];

const koreTeamPhoto = {
  src: koreTeamLunch,
  width: 1200,
  height: 1600,
  alt: 'Quang seated at lunch with members of the KORE Wireless engineering team',
  caption: 'Team lunch near the end of my software engineering co-op at KORE Wireless',
};

// Display order is the mosaic order: one wide card and one narrow card per row, alternating sides.
const interests = [
  {
    title: 'Photography',
    icon: FaCamera,
    layout: 'wide',
    copy: 'Photography gives me room to experiment with how composition, lighting, and perspective shape an image.',
    photo: { src: photographySunset, width: 1200, height: 1500, alt: 'Golden sunset clouds reflected across waves at the edge of a lake', position: 'center 67%' },
  },
  {
    title: 'Music',
    icon: FaMusic,
    copy: 'I like listening to music, discovering new artists, and playing guitar recreationally.',
    photo: { src: musicPhoto, width: 1200, height: 1600, alt: 'Quang playing guitar', position: 'center 28%' },
  },
  {
    title: 'Hiking',
    icon: FaMountain,
    copy: 'Getting outside, exploring new places, and taking a break from screens helps me recharge.',
    photo: { src: hikingOverlook, width: 1600, height: 1150, alt: 'Quang standing with arms outstretched at a scenic lake overlook', position: 'center 70%' },
  },
  {
    title: 'Technology',
    icon: FaDesktop,
    layout: 'wide flip',
    copy: 'I enjoy understanding how technology works beyond the software, from building and upgrading PCs to experimenting with hardware and different devices.',
    photo: { src: customPcGreen, width: 1050, height: 1400, alt: 'Computer hardware and a custom desktop PC during a hands-on build' },
  },
  {
    title: 'Cars',
    icon: FaCar,
    copy: (
      <>
        I enjoy learning how cars work, from understanding what is happening under the hood to maintaining, upgrading, and documenting them. I also keep a{' '}
        <a href="https://gc8quang.vercel.app/" target="_blank" rel="noreferrer">photo archive of my blue Subaru Impreza 2.5RS</a>.
      </>
    ),
    photo: { src: carsPhoto, width: 1400, height: 933, alt: 'A blue classic sports car displayed behind a fence' },
  },
  {
    title: 'Gaming',
    icon: FaGamepad,
    layout: 'wide',
    copy: 'I like games that reward exploration, strategy, progression, and building things over time.',
    photo: { src: minecraftWorld, width: 1600, height: 861, alt: 'A detailed Minecraft survival world with a castle, village, farms, and modern buildings at sunset' },
  },
];

const values = [
  {
    title: 'Curiosity',
    copy: 'I like understanding why a system behaves the way it does, especially when the obvious explanation is incomplete.',
    example: 'At KORE Wireless, that meant reproducing production integration failures in QA before troubleshooting them.',
  },
  {
    title: 'Reliability',
    copy: 'I care about software that behaves predictably, handles failure intentionally, and stays understandable over time.',
    example: 'Hymical Forms, my open-source form backend, signs every webhook delivery, retries within limits, and keeps a history of each attempt.',
  },
  {
    title: 'Usefulness',
    copy: 'I like taking ideas beyond prototypes and turning them into practical tools someone could genuinely rely on.',
    example: '585Dashcam585 replaced a family-owned Rochester business’s hosted website with a custom application that takes live payments.',
  },
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
  { src: subaru25rs, width: 1500, height: 2000, alt: 'Blue Subaru Impreza 2.5RS parked beside the waterfront', caption: 'My Subaru Impreza 2.5RS', shape: 'portrait' },
  { src: subaruEngineBay, width: 2000, height: 1500, alt: 'Engine bay of a blue Subaru Impreza 2.5RS during maintenance', caption: 'Learning my way around the EJ25 engine', shape: 'landscape' },
  { src: carShowPorsche, width: 1400, height: 984, alt: 'A black Singer Porsche 930 displayed at Little Speed Shop Cars & Coffee', caption: 'Singer Porsche 930 at Cars & Coffee', shape: 'landscape' },
  { src: carShowSubaruEngine, width: 1400, height: 889, alt: 'Modified blue Blobeye STI with its engine bay open at a car show', caption: 'A closer look at this Blobeye STI', shape: 'landscape' },
  { src: carShowCrowd, width: 2048, height: 1536, alt: 'Crowded Cars & Coffee meet with sports cars on display', caption: 'Cars & Coffee in full swing', shape: 'landscape' },
  { src: nobleM12, width: 1536, height: 2048, alt: 'Gray Noble M12 displayed at Cars & Coffee', caption: 'Noble M12 at Cars & Coffee', shape: 'portrait' },
  { src: audiR8, width: 1536, height: 2048, alt: 'Black Audi R8 displayed at Cars & Coffee', caption: 'Audi R8 at Cars & Coffee', shape: 'portrait' },
  { src: toyotaSupraMk3, width: 1536, height: 2048, alt: 'Black Mk3 Toyota Supra displayed at Cars & Coffee', caption: 'Mk3 Toyota Supra at Cars & Coffee', shape: 'portrait' }
];

const technologyGallery = [
  { src: roomSetup2025, width: 1500, height: 2000, alt: 'Room setup with dual monitors, a custom desktop PC, and illuminated peripherals', caption: 'Room setup, 2025', shape: 'portrait' },
  { src: techPhoto, width: 1050, height: 1400, alt: 'Computer hardware and a custom desktop PC during a hands-on build', caption: 'Building a PC from the ground up', shape: 'portrait' },
  { src: graphicsCard, width: 1050, height: 1400, alt: 'An RTX 3080 Ti graphics card held above a work surface', caption: 'Getting an RTX 3080 Ti Founders Edition ready for its next build', shape: 'portrait' },
  { src: motherboardUpgrade, width: 1500, height: 2000, alt: 'Desktop motherboard and Intel CPU cooler removed during a computer upgrade', caption: 'Between upgrades, 2024', shape: 'portrait' },
  { src: technologyWorkstation, width: 2000, height: 1500, alt: 'Multi-monitor desktop computer and workstation setup', caption: 'My dorm setup', shape: 'landscape' }
];

const gamingGallery = [
  { src: minecraftCherryHouse, width: 2000, height: 1084, alt: 'Minecraft house built among cherry trees with a mountain backdrop', caption: 'Cozy Minecraft cabin, 2026', shape: 'landscape' },
  { src: marvelRivalsMvpStats, width: 2000, height: 887, alt: 'Marvel Rivals victory scoreboard showing an MVP performance with 67 KOs', caption: 'Marvel Rivals 67 KOs, 2025', shape: 'landscape' },
  { src: simRacingSetup, width: 1500, height: 2000, alt: 'Steering wheel, shifter, pedals, and curved monitor arranged for sim racing', caption: 'Sim racing, 2024', shape: 'portrait' },
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
    if (currentState()?.restorePhotographyModal) return null;
    if (window.location.hash === '#photography') return 'photography';
    return window.location.hash === '#music' ? 'music' : null;
  });
  const [directLightbox, setDirectLightbox] = useState(null);
  const galleryTrigger = useRef(null);
  const lightboxTrigger = useRef(null);

  useLayoutEffect(() => {
    const shouldRestore = Boolean(currentState()?.restorePhotographyModal);
    if (!shouldRestore) return;
    const sectionId = currentState()?.returnSection ?? 'beyond-software';
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
            <div className="about-hero-intro">
              <p className="eyebrow" style={{ '--i': 0 }}>A little more about me</p>
              <h1 id="about-page-title" style={{ '--i': 1 }}>Hi, I’m Quang.</h1>
              <p className="about-location" style={{ '--i': 2 }}><FaMapMarkerAlt aria-hidden="true" /> Rochester, New York, USA</p>
            </div>
            <figure className="about-portrait" style={{ '--i': 2 }}>
              <div className="about-portrait-stack">
                <div className="viewfinder about-portrait-frame">
                  <button className="about-portrait-button" type="button" aria-label="View more photos of Quang" aria-haspopup="dialog" onClick={(event) => openGallery('personal', event.currentTarget)}>
                    <img src={quangPhoto} width="1000" height="1000" alt="Quang seated on a bench outdoors" fetchPriority="high" />
                    <span className="about-portrait-more"><FaImages aria-hidden="true" /> {personalGallery.length} more photos</span>
                  </button>
                </div>
              </div>
            </figure>
            <div className="about-hero-body">
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
          </div>
          <div className="section-inner">
            <nav className="about-index" aria-label="On this page" style={{ '--i': 5 }}>
              <ol>
                {pageIndex.map(([id, label]) => (
                  <li key={id}><a href={`#${id}`}>{label} <FaArrowDown aria-hidden="true" /></a></li>
                ))}
              </ol>
            </nav>
          </div>
        </section>

        <section id="path" className="page-section about-path" aria-labelledby="path-title">
          <div className="section-inner">
            <div className="section-heading" data-reveal>
              <div><p className="eyebrow">My path into software</p><h2 id="path-title">From coursework to production software</h2></div>
              <p>How experimenting with technology turned into studying it, and then into building software people rely on.</p>
            </div>

            <ol className="about-timeline">
              <li className="about-chapter" data-reveal>
                <div className="about-chapter__marker"><span className="about-chapter__num" aria-hidden="true">01</span><span className="about-chapter__when">Growing up</span></div>
                <div className="about-chapter__body">
                  <h3>Curiosity before code</h3>
                  <p>
                    Minecraft mods and servers, rooted and jailbroken devices, and PC builds and upgrades:
                    experimenting was how I learned, and it is what made me want to build software of my own.
                  </p>
                </div>
              </li>

              <li className="about-chapter" data-reveal>
                <div className="about-chapter__marker"><span className="about-chapter__num" aria-hidden="true">02</span><span className="about-chapter__when">Rochester Institute of Technology</span></div>
                <div className="about-chapter__body">
                  <h3>Studying computer science</h3>
                  <p>
                    I’m in RIT’s accelerated BS/MS program in Computer Science, expected to graduate in 2028.
                  </p>
                </div>
              </li>

              <li className="about-chapter about-chapter--feature" data-reveal>
                <div className="about-chapter__marker"><span className="about-chapter__num" aria-hidden="true">03</span><span className="about-chapter__when"><time dateTime="2025-01">Jan</time> – <time dateTime="2025-05">May 2025</time></span></div>
                <div className="about-chapter__body">
                  <h3>IoT Software Engineering Co-op at KORE Wireless</h3>
                  <div className="about-chapter__prose">
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
                  </div>
                  <figure className="kore-team-photo viewfinder">
                    <ImageTrigger className="kore-team-photo-button" label="Open KORE Wireless team lunch photo" onOpen={(trigger) => openDirectLightbox(koreTeamPhoto, trigger)}>
                      <img src={koreTeamPhoto.src} width={koreTeamPhoto.width} height={koreTeamPhoto.height} alt={koreTeamPhoto.alt} loading="lazy" decoding="async" />
                    </ImageTrigger>
                    <figcaption>{koreTeamPhoto.caption}</figcaption>
                  </figure>
                  <blockquote className="about-quote">
                    <p>“He was able to work with greater independence than is expected of co-ops.”</p>
                    <footer>
                      <cite>Matt Telesky, Director of Software Engineering</cite>
                    </footer>
                  </blockquote>
                </div>
              </li>

              <li className="about-chapter" data-reveal>
                <div className="about-chapter__marker"><span className="about-chapter__num" aria-hidden="true">04</span><span className="about-chapter__when">Since then</span></div>
                <div className="about-chapter__body">
                  <h3>Outside the happy path</h3>
                  <p>
                    That experience changed how I approach my own projects. I became much more interested in
                    reliability, failure handling, data correctness, and what happens outside the happy path.
                  </p>
                  <p>
                    I have since designed, built, deployed, and maintained production web applications
                    for family-owned Rochester businesses, alongside my native Apple, backend, and
                    open-source engineering work.
                  </p>
                  <a className="text-link about-chapter__link" href={homeHref('#projects')}>See the featured projects <FaArrowRight aria-hidden="true" /></a>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section id="beyond-software" className="page-section about-beyond" aria-labelledby="beyond-title">
          <div className="section-inner">
            <div className="section-heading" data-reveal><div><p className="eyebrow">Outside the editor</p><h2 id="beyond-title">Beyond software</h2></div><p>A few of the things I make time for away from work and school.</p></div>
            <div className="interest-grid">
              {interests.map(({ title, icon, copy, photo, layout }) => {
                const gallery = interestGalleryKeys[title];
                const modifiers = [`interest-card--${gallery}`, ...(layout ? layout.split(' ').map((name) => `interest-card--${name}`) : [])];
                return (
                  <InterestCard
                    key={title}
                    className={modifiers.join(' ')}
                    kicker={galleryEyebrow(gallery)}
                    icon={icon}
                    title={title}
                    copy={copy}
                    photos={[photo]}
                    gallery={gallery}
                    galleryItems={galleries[gallery]}
                    hasNonPhotoContent={gallery === 'music'}
                    onOpen={openGallery}
                    onOpenImage={(image, trigger) => openDirectLightbox({ src: image.src, alt: image.alt, caption: image.caption ?? title }, trigger)}
                    accessory={gallery === 'music' ? <SpotifyDisc className="interest-card-disc" onClick={(event) => openGallery('music', event.currentTarget)} /> : null}
                    extra={gallery === 'photography' ? <a className="interest-card-link" href={photographyPageHref}>Photography page <FaArrowRight aria-hidden="true" /></a> : null}
                  />
                );
              })}
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

        <section id="approach" className="page-section about-values" aria-labelledby="values-title">
          <div className="section-inner">
            <div className="section-heading" data-reveal><div><p className="eyebrow">How I like to work</p><h2 id="values-title">How I approach engineering</h2></div><p>Three principles I return to when I’m learning, building, and collaborating.</p></div>
            <ol className="values-list">
              {values.map(({ title, copy, example }, index) => (
                <li className="value-row" key={title} data-reveal style={{ '--reveal-delay': `${index * 90}ms` }}>
                  <span className="value-row__num" aria-hidden="true">0{index + 1}</span>
                  <div className="value-row__copy"><h3>{title}</h3><p>{copy}</p></div>
                  <p className="value-row__example"><span>In practice</span>{example}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <div className="page-section about-closing">
          <div className="section-inner about-closing-grid">
            <section id="currently" className="currently" aria-labelledby="currently-title" data-reveal>
              <h2 id="currently-title" className="currently__title">Currently</h2>
              <dl>
                {currently.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </section>

            <section className="about-cta" aria-labelledby="about-cta-title" data-reveal style={{ '--reveal-delay': '90ms' }}>
              <p className="eyebrow">Keep exploring</p>
              <h2 id="about-cta-title">Want to see what I’ve been building?</h2>
              <ul className="about-next-links">
                <li>
                  <a href={homeHref('#projects')}>
                    <strong>Featured projects</strong><small>Case files, screenshots, and what each one does</small>
                    <FaArrowRight aria-hidden="true" />
                  </a>
                </li>
                <li>
                  <a href="https://github.com/quangshuynh" target="_blank" rel="noreferrer">
                    <strong>GitHub</strong><small>Code, releases, and open-source work<span className="visually-hidden"> (opens in a new tab)</span></small>
                    <FaExternalLinkAlt aria-hidden="true" />
                  </a>
                </li>
                <li>
                  <a href={resumeHref} target="_blank" rel="noreferrer">
                    <strong>Résumé</strong><small>PDF, opens in a new tab</small>
                    <FaExternalLinkAlt aria-hidden="true" />
                  </a>
                </li>
                <li>
                  <a href="#contact">
                    <strong>Contact</strong><small>Email, GitHub, and LinkedIn, just below</small>
                    <FaArrowDown aria-hidden="true" />
                  </a>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </main>
      {directLightbox && <PhotoLightbox image={directLightbox} onClose={closeDirectLightbox} />}
      <Footer />
    </div>
  );
}

export default AboutPage;
