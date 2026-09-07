import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaArrowRight, FaCamera, FaCar, FaGamepad, FaMapMarkerAlt, FaMountain, FaMusic, FaTimes, FaUsers, FaMinus, FaPlus, FaSearchPlus } from 'react-icons/fa';
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

const interests = [
  [FaCamera, 'Photography', 'I enjoy photography and experimenting with how composition, lighting, and perspective shape an image.'],
  [FaMountain, 'Hiking', 'I enjoy getting outside, exploring new places, and taking a break from screens.'],
  [FaMusic, 'Music', 'I enjoy listening to music, discovering new artists, and playing guitar recreationally.', 'https://open.spotify.com/user/foahrtqqvuuvt7wscxub4uerd'],
  [FaCar, 'Cars & technology', 'I’ve always been interested in technology beyond computers, including cars and how mechanical and electronic systems work.'],
  [FaGamepad, 'Gaming', 'Gaming is one of the ways I relax and was also part of what originally made computers interesting to me.'],
  [FaUsers, 'Family & friends', 'Spending time with family and friends is an important part of my life, especially over a meal, a game, or a shared activity.']
];

const interestPhotos = {
  Photography: [[photographySunset, 1200, 1500, 'Golden sunset clouds reflected across waves at the edge of a lake']],
  Hiking: [[hikingOverlook, 1600, 1150, 'Quang standing with arms outstretched at a scenic lake overlook']],
  Music: [[musicPhoto, 1200, 1600, 'Quang playing guitar']],
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
  [riversideBridge]: 'Red steel bridge over the Genesee River',
  [horizonSunset]: 'Watching the last light disappear over the water',
  [riversideWaterfall]: 'Rochester Lower Falls overlook',
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

const gamingGallery = [
  [csgoScreenshot, 1152, 864, 'Counter-Strike: Global Offensive menu screenshot', 'CS:GO menu screen 2022']
];

function AboutPage() {
  const [activeGallery, setActiveGallery] = useState(null);
  const [showAllPhotography, setShowAllPhotography] = useState(false);

  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [lightboxPosition, setLightboxPosition] = useState({
    x: 0,
    y: 0
  });

  const closeGalleryButton = useRef(null);
  const closeLightboxButton = useRef(null);
  const galleryTrigger = useRef(null);
  const lightboxDrag = useRef(null);

  const [spotifyTracks, setSpotifyTracks] = useState([]);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyError, setSpotifyError] = useState(false);

  const loadSpotifyTracks = async () => {
    if (spotifyTracks.length || spotifyLoading) {
      return;
    }

    setSpotifyLoading(true);
    setSpotifyError(false);

    try {
      const response = await fetch(
        'https://spotify-portfolio-api.quangs.workers.dev/recent'
      );

      if (!response.ok) {
        throw new Error('Spotify request failed');
      }

      const data = await response.json();
      setSpotifyTracks(data.tracks ?? []);
    } catch {
      setSpotifyError(true);
    } finally {
      setSpotifyLoading(false);
    }
  };

  const openGallery = (gallery, trigger) => {
    galleryTrigger.current = trigger;
    setActiveGallery(gallery);
  };

  const closeGallery = () => {
    setLightboxImage(null);
    setLightboxScale(1);
    setLightboxPosition({ x: 0, y: 0 });

    setActiveGallery(null);
    setShowAllPhotography(false);
  };

  const openLightbox = (src, alt, caption) => {
    setLightboxImage({
      src,
      alt,
      caption
    });

    setLightboxScale(1);
    setLightboxPosition({ x: 0, y: 0 });
  };

  const closeLightbox = () => {
    setLightboxImage(null);
    setLightboxScale(1);
    setLightboxPosition({ x: 0, y: 0 });
  };

  const zoomLightbox = useCallback((amount) => {
    setLightboxScale((currentScale) => {
      const nextScale = Math.min(
        5,
        Math.max(
          1,
          Number((currentScale + amount).toFixed(2))
        )
      );

      if (nextScale === 1) {
        setLightboxPosition({ x: 0, y: 0 });
      }

      return nextScale;
    });
  }, []);

  const resetLightbox = () => {
    setLightboxScale(1);
    setLightboxPosition({ x: 0, y: 0 });
  };

  const handleLightboxWheel = (event) => {
    event.preventDefault();

    const delta = Math.max(-100, Math.min(100, event.deltaY));
    const zoomAmount = -delta * 0.0025;

    zoomLightbox(zoomAmount);
  };

  const handleLightboxPointerDown = (event) => {
    if (lightboxScale <= 1 || event.button === 2) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    lightboxDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: lightboxPosition.x,
      originY: lightboxPosition.y
    };
  };

  const handleLightboxPointerMove = (event) => {
    const drag = lightboxDrag.current;

    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      lightboxScale <= 1
    ) {
      return;
    }

    setLightboxPosition({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    });
  };

  const handleLightboxPointerUp = (event) => {
    if (lightboxDrag.current?.pointerId === event.pointerId) {
      lightboxDrag.current = null;

      if (
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(
          event.pointerId
        );
      }
    }
  };

  const handleLightboxDoubleClick = () => {
    if (lightboxScale > 1) {
      resetLightbox();
    } else {
      setLightboxScale(2);
    }
  };

useEffect(() => {
  if (!activeGallery) {
    return undefined;
  }

  const previousOverflow =
    document.body.style.overflow;

  document.body.style.overflow = 'hidden';
  closeGalleryButton.current?.focus();

  const handleTabKey = (event) => {
    if (
      event.key !== 'Tab' ||
      document.querySelector('.photo-lightbox-backdrop')
    ) {
      return;
    }

    const modal =
      closeGalleryButton.current?.closest(
        '.photography-modal'
      );

    const controls = modal?.querySelectorAll(
      'button:not([disabled]), a[href]'
    );

    if (!controls?.length) {
      return;
    }

    const first = controls[0];
    const last = controls[controls.length - 1];

    if (
      event.shiftKey &&
      document.activeElement === first
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === last
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  document.addEventListener(
    'keydown',
    handleTabKey
  );

  return () => {
    document.body.style.overflow =
      previousOverflow;

    document.removeEventListener(
      'keydown',
      handleTabKey
    );

    galleryTrigger.current?.focus();
  };
}, [activeGallery]);

useEffect(() => {
  if (!activeGallery) {
    return undefined;
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      if (lightboxImage) {
        closeLightbox();
      } else {
        closeGallery();
      }

      return;
    }

    if (!lightboxImage) {
      return;
    }

    if (event.key === 'Tab') {
      const lightbox = document.querySelector(
        '.photo-lightbox-backdrop'
      );

      const controls =
        lightbox?.querySelectorAll(
          'button:not([disabled])'
        );

      if (!controls?.length) {
        return;
      }

      const first = controls[0];
      const last =
        controls[controls.length - 1];

      if (
        event.shiftKey &&
        document.activeElement === first
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }

      return;
    }

    if (
      event.key === '+' ||
      event.key === '='
    ) {
      event.preventDefault();
      zoomLightbox(0.25);
    } else if (
      event.key === '-' ||
      event.key === '_'
    ) {
      event.preventDefault();
      zoomLightbox(-0.25);
    } else if (event.key === '0') {
      event.preventDefault();
      resetLightbox();
    }
  };

  document.addEventListener(
    'keydown',
    handleKeyDown
  );

  return () => {
    document.removeEventListener(
      'keydown',
      handleKeyDown
    );
  };
}, [activeGallery, lightboxImage, zoomLightbox]);

useEffect(() => {
  if (lightboxImage) {
    closeLightboxButton.current?.focus();
  }
}, [lightboxImage]);

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
            <div className="about-story-intro">
              <p className="eyebrow">My path into software</p>
              <h2 id="path-title">From the classroom to production.</h2>

              <figure className="kore-team-photo">
                <img
                  src={koreTeamLunch}
                  width="1200"
                  height="1600"
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
                My first professional software engineering role was at KORE Wireless through RIT’s co-op program. It was my first opportunity to move beyond coursework and contribute to production systems used to support real business operations.
              </p>

              <p>
                Over five months, I went from learning an unfamiliar enterprise codebase and integration environment to taking on increasingly independent engineering work. I learned how much of professional software development happens beyond writing the initial feature: understanding existing systems, tracing failures across applications and databases, testing changes safely, working with other engineers, and maintaining software that people already depend on.
              </p>

              <p>
                That experience changed how I approach my own projects. I became much more interested in reliability, failure handling, data correctness, and what happens outside the happy path.
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
              {interests.map(([Icon, title, copy, href]) => {
                const photos = interestPhotos[title];
                return (
                  <article className="interest-card" key={title}>
                    {photos && (
                      <div
                        className={`interest-card-media${
                          photos.length > 1 ? ' interest-card-media-pair' : ''
                        }${
                          title === 'Photography'
                            ? ' interest-card-media-photography'
                            : ''
                        }${
                          title === 'Music'
                            ? ' interest-card-media-music'
                            : ''
                        }${
                          title === 'Hiking'
                            ? ' interest-card-media-hiking'
                            : ''
                        }
                        `}
                      >
                        {photos.map(([src, width, height, alt]) => <img src={src} width={width} height={height} alt={alt} key={src} />)}
                      </div>
                    )}
                    <h3><Icon aria-hidden="true" />{title}</h3>
                    <p>{copy}</p>
                      {title === 'Music' && (
                        <button
                          className="interest-view-more"
                          type="button"
                          aria-haspopup="dialog"
                          onClick={(event) => {
                            loadSpotifyTracks();
                            openGallery('music', event.currentTarget);
                          }}
                        >
                          View listening
                        </button>
                      )}
                    {(title === 'Photography' || title === 'Cars & technology' || title === 'Gaming') && (
                      <button className="interest-view-more" type="button" aria-haspopup="dialog" onClick={(event) => openGallery(title === 'Photography' ? 'photography' : title === 'Gaming' ? 'gaming' : 'technology', event.currentTarget)}>View more</button>
                    )}
                  </article>
                );
              })}
            </div>
            {activeGallery && (
              <div className="photography-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeGallery(); }}>
                <section className="photography-modal" role="dialog" aria-modal="true" aria-labelledby="interest-modal-title">
                  <div className="photography-modal-header">
                    <div>
                      <p className="eyebrow">
                        {activeGallery === 'photography'
                          ? 'Behind the lens'
                          : activeGallery === 'personal'
                            ? 'Beyond the résumé'
                            : activeGallery === 'gaming'
                              ? 'In the game'
                              : activeGallery === 'music'
                                ? 'On repeat'
                                : 'Under the hood'}
                      </p>

                      <h3 id="interest-modal-title">
                        {activeGallery === 'photography'
                          ? 'Photography by Quang'
                          : activeGallery === 'personal'
                            ? 'More about Quang'
                            : activeGallery === 'gaming'
                              ? 'Gaming'
                              : activeGallery === 'music'
                                ? 'What I’ve been listening to'
                                : 'Cars & technology'}
                      </h3>
                    </div>
                    <button
                      className="photography-modal-close"
                      type="button"
                      onClick={closeGallery}
                      ref={closeGalleryButton}
                      aria-label={`Close ${
                        activeGallery === 'photography'
                          ? 'photography gallery'
                          : activeGallery === 'personal'
                            ? 'personal photo gallery'
                            : activeGallery === 'gaming'
                              ? 'gaming gallery'
                              : activeGallery === 'music'
                                ? 'music activity'
                                : 'cars and technology gallery'
                      }`}
                    >
                      <FaTimes aria-hidden="true" />
                    </button>
                  </div>
                  {activeGallery === 'personal' ? <div className="photography-gallery personal-gallery" aria-label="More photos of Quang">
                    {personalGallery.map(
                      ([src, width, height, alt, caption, shape]) => (
                        <figure
                          className={
                            shape === 'portrait'
                              ? 'photography-gallery-portrait'
                              : undefined
                          }
                          key={src}
                        >
                          <button
                            className="photography-gallery-image-button"
                            type="button"
                            onClick={() =>
                              openLightbox(src, alt, caption)
                            }
                            aria-label={`Open image: ${caption}`}
                          >
                            <img
                              src={src}
                              width={width}
                              height={height}
                              alt={alt}
                              loading="lazy"
                            />

                            <span
                              className="photography-gallery-zoom-hint"
                              aria-hidden="true"
                            >
                              <FaSearchPlus />
                            </span>
                          </button>

                          <figcaption>{caption}</figcaption>
                        </figure>
                      )
                    )}
                  </div> : activeGallery === 'photography' ? <>
                    <div className="photography-gallery" id="photography-gallery" aria-label="More photographs by Quang">
                      {(showAllPhotography ? photographyGallery : photographyGallery.slice(0, 3)).map(([src, width, height, alt, shape]) => (
                        <figure
                          className={
                            shape === 'portrait'
                              ? 'photography-gallery-portrait'
                              : undefined
                          }
                          key={src}
                        >
                          <button
                            className="photography-gallery-image-button"
                            type="button"
                            onClick={() =>
                              openLightbox(
                                src,
                                alt,
                                photographyCaptions[src]
                              )
                            }
                            aria-label={`Open image: ${photographyCaptions[src]}`}
                          >
                            <img
                              src={src}
                              width={width}
                              height={height}
                              alt={alt}
                              loading="lazy"
                            />

                            <span
                              className="photography-gallery-zoom-hint"
                              aria-hidden="true"
                            >
                              <FaSearchPlus />
                            </span>
                          </button>

                          <figcaption>
                            {photographyCaptions[src]}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                    {!showAllPhotography && <button className="button photography-view-all" type="button" onClick={() => setShowAllPhotography(true)}>View all</button>}
                    </> : activeGallery === 'gaming' ? (
                      <div
                        className="photography-gallery gaming-gallery"
                        aria-label="More gaming screenshots"
                      >
                        {gamingGallery.map(([src, width, height, alt, caption]) => (
                          <figure key={src}>
                            <button
                              className="photography-gallery-image-button"
                              type="button"
                              onClick={() => openLightbox(src, alt, caption)}
                              aria-label={`Open image: ${caption}`}
                            >
                              <img
                                src={src}
                                width={width}
                                height={height}
                                alt={alt}
                                loading="lazy"
                              />

                              <span
                                className="photography-gallery-zoom-hint"
                                aria-hidden="true"
                              >
                                <FaSearchPlus />
                              </span>
                            </button>

                            <figcaption>{caption}</figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : activeGallery === 'music' ? (
                      <div className="spotify-listening">
                        {spotifyLoading ? (
                          <p>Loading recent listening...</p>
                        ) : spotifyError ? (
                          <div className="spotify-listening-status">
                            <p>Couldn’t load my recent listening right now.</p>

                            <a
                              className="interest-view-more"
                              href="https://open.spotify.com/user/foahrtqqvuuvt7wscxub4uerd"
                              target="_blank"
                              rel="noreferrer"
                            >
                              View my Spotify
                            </a>
                          </div>
                        ) : spotifyTracks.length ? (
                          <>
                            <div className="spotify-track-list">
                              {spotifyTracks.map((track) => (
                                <a
                                  className="spotify-track"
                                  href={track.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  key={`${track.id}-${track.playedAt}`}
                                >
                                  {track.image && (
                                    <img
                                      src={track.image}
                                      alt=""
                                      loading="lazy"
                                    />
                                  )}

                                  <div>
                                    <strong>{track.name}</strong>
                                    <span>{track.artist}</span>
                                    <small>{track.album}</small>
                                  </div>
                                </a>
                              ))}
                            </div>

                            <a
                              className="interest-view-more spotify-profile-link"
                              href="https://open.spotify.com/user/foahrtqqvuuvt7wscxub4uerd"
                              target="_blank"
                              rel="noreferrer"
                            >
                              View my Spotify
                            </a>
                          </>
                        ) : (
                          <p>No recent listening activity to show.</p>
                        )}
                      </div>
                    ) : (
                      <div
                        className="photography-gallery technology-gallery"
                        aria-label="More cars and technology photos"
                      >
                        {technologyGallery.map(([src, width, height, alt, caption, shape]) => (
                          <figure
                            className={
                              shape === 'portrait'
                                ? 'photography-gallery-portrait'
                                : undefined
                            }
                            key={src}
                          >
                            <button
                              className="photography-gallery-image-button"
                              type="button"
                              onClick={() => openLightbox(src, alt, caption)}
                              aria-label={`Open image: ${caption}`}
                            >
                              <img
                                src={src}
                                width={width}
                                height={height}
                                alt={alt}
                                loading="lazy"
                              />

                              <span
                                className="photography-gallery-zoom-hint"
                                aria-hidden="true"
                              >
                                <FaSearchPlus />
                              </span>
                            </button>

                            <figcaption>{caption}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                </section>
              </div>
            )}

            {lightboxImage && (
              <div
                className="photo-lightbox-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label={
                  lightboxImage.caption
                    ? `Image viewer: ${lightboxImage.caption}`
                    : 'Image viewer'
                }
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    closeLightbox();
                  }
                }}
              >
                <div className="photo-lightbox-toolbar">
                  <div
                    className="photo-lightbox-zoom-controls"
                    aria-label="Image zoom controls"
                  >
                    <button
                      type="button"
                      onClick={() => zoomLightbox(-0.25)}
                      disabled={lightboxScale <= 1}
                      aria-label="Zoom out"
                    >
                      <FaMinus aria-hidden="true" />
                    </button>

                    <button
                      className="photo-lightbox-scale"
                      type="button"
                      onClick={resetLightbox}
                      aria-label="Reset zoom"
                    >
                      {Math.round(lightboxScale * 100)}%
                    </button>

                    <button
                      type="button"
                      onClick={() => zoomLightbox(0.25)}
                      disabled={lightboxScale >= 5}
                      aria-label="Zoom in"
                    >
                      <FaPlus aria-hidden="true" />
                    </button>
                  </div>

                  <button
                    className="photo-lightbox-close"
                    type="button"
                    onClick={closeLightbox}
                    ref={closeLightboxButton}
                    aria-label="Close image viewer"
                  >
                    <FaTimes aria-hidden="true" />
                  </button>
                </div>

                <div
                  className={`photo-lightbox-stage${
                    lightboxScale > 1 ? ' is-zoomed' : ''
                  }`}
                  onWheel={handleLightboxWheel}
                  onPointerDown={handleLightboxPointerDown}
                  onPointerMove={handleLightboxPointerMove}
                  onPointerUp={handleLightboxPointerUp}
                  onPointerCancel={handleLightboxPointerUp}
                  onDoubleClick={handleLightboxDoubleClick}
                >
                  <img
                    src={lightboxImage.src}
                    alt={lightboxImage.alt}
                    draggable="false"
                    style={{
                      transform: `translate3d(${lightboxPosition.x}px, ${lightboxPosition.y}px, 0) scale(${lightboxScale})`
                    }}
                  />
                </div>

                {lightboxImage.caption && (
                  <p className="photo-lightbox-caption">
                    {lightboxImage.caption}
                  </p>
                )}

                <p className="photo-lightbox-help">
                  Scroll or use + and − to zoom. Drag to pan.
                  Double-click to zoom. Press 0 to reset.
                </p>
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
