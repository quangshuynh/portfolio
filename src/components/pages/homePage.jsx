import Header from '../sections/header';
import Experience from '../sections/experience';
import FeaturedProjects from '../sections/featuredProjects';
import TechStack from '../sections/techStack';
import MoreProjects from '../sections/moreProjects';
import Education from '../sections/education';
import Footer from '../sections/footer';
import HashScroll from '../utilities/hashScroll';
import { HomeLightboxProvider } from '../utilities/homeLightbox';
import SiteNav from '../sections/siteNav';
import RevealAnimations from '../utilities/revealAnimations';

// The homepage, its own chunk so the photography and editor routes do not download its
// sections and project data (the static home HTML modulepreloads it, src/seo/site.mjs).
export default function HomePage() {
  return (
    <HomeLightboxProvider>
      <div className="app-shell">
        <HashScroll />
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <SiteNav current="home" />
        <Header />
        <main id="main-content">
          <Experience />
          <FeaturedProjects />
          <MoreProjects />
          <TechStack />
          <Education />
        </main>
        <Footer />
        <RevealAnimations />
      </div>
    </HomeLightboxProvider>
  );
}
