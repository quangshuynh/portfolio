import { useEffect } from 'react';

export default function RevealAnimations() {
  useEffect(() => {
    const stops = Array.from(document.querySelectorAll('.scroll-enter'));
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      stops.forEach((stop) => stop.classList.add('is-visible'));
      return undefined;
    }

    document.documentElement.classList.add('reveal-ready');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    stops.forEach((stop) => observer.observe(stop));
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('reveal-ready');
    };
  }, []);

  return null;
}
