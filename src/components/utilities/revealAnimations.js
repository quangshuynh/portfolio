import { useEffect } from 'react';

const SELECTOR = '[data-reveal]';

/**
 * Reveals `[data-reveal]` elements once as they enter the viewport. Content is
 * visible by default; hiding only starts once this effect runs, and elements
 * added later (expanded project lists, lazy routes) are observed too.
 */
export default function RevealAnimations() {
  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion || !('IntersectionObserver' in window)) {
      document.querySelectorAll(SELECTOR).forEach((element) => element.classList.add('is-visible'));
      return undefined;
    }

    const root = document.documentElement;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });

    const observeAll = (scope) => {
      if (scope.matches?.(SELECTOR) && !scope.classList.contains('is-visible')) observer.observe(scope);
      scope.querySelectorAll?.(SELECTOR).forEach((element) => {
        if (!element.classList.contains('is-visible')) observer.observe(element);
      });
    };

    observeAll(document.body);
    root.classList.add('reveal-ready');

    const mutations = typeof MutationObserver === 'function'
      ? new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) observeAll(node);
      })))
      : null;
    mutations?.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations?.disconnect();
      root.classList.remove('reveal-ready');
    };
  }, []);

  return null;
}
