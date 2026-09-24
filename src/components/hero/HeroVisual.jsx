import { useEffect, useRef, useState } from 'react';
import './heroVisual.css';

const loadScene = () => import('./interactiveHeroScene');

export function StaticHeroScene() {
  return (
    <picture className="hero-desk__fallback">
      <source
        media="(max-width: 620px)"
        srcSet={`${import.meta.env.BASE_URL}hero/desk-mobile.webp`}
      />
      <source
        media="(max-width: 1100px)"
        srcSet={`${import.meta.env.BASE_URL}hero/desk-tablet.webp`}
      />
      <source
        media="(max-height: 820px)"
        srcSet={`${import.meta.env.BASE_URL}hero/desk-compact.webp`}
      />
      <img
        src={`${import.meta.env.BASE_URL}hero/desk-desktop.webp`}
        width="1000"
        height="440"
        alt=""
        decoding="async"
      />
    </picture>
  );
}

export default function HeroVisual({ load = loadScene }) {
  const host = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = host.current;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const connection = navigator.connection;
    let stopped = false,
      failed = false,
      visible = false,
      loading = false,
      instance,
      idle,
      timer,
      generation = 0;
    const allowed = () =>
      motion &&
      !motion.matches &&
      !connection?.saveData &&
      !/^(slow-2g|2g|3g)$/.test(connection?.effectiveType || '') &&
      !(navigator.deviceMemory && navigator.deviceMemory <= 2) &&
      !(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
    function cancelScheduled() {
      window.clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      idle = undefined;
    }
    function fallback() {
      failed = true;
      instance?.dispose();
      instance = undefined;
      if (!stopped) setReady(false);
    }
    async function start() {
      idle = undefined;
      if (
        stopped ||
        failed ||
        loading ||
        instance ||
        !visible ||
        document.hidden ||
        !allowed()
      )
        return;
      loading = true;
      const run = generation;
      try {
        const module = await load();
        if (
          stopped ||
          run !== generation ||
          !visible ||
          document.hidden ||
          !allowed()
        )
          return;
        instance = module.mountDeskScene(element, {
          onReady: () => {
            if (!stopped && !failed) setReady(true);
          },
          onError: fallback,
        });
        if (failed) {
          instance.dispose();
          instance = undefined;
        } else instance.setActive(visible);
      } catch {
        fallback();
      } finally {
        loading = false;
        if (!stopped && run !== generation) schedule();
      }
    }
    function schedule() {
      cancelScheduled();
      if (!visible || document.hidden || !allowed() || failed) return;
      if (instance) {
        instance.setActive(true);
        return;
      }
      // Give hero copy, fonts and the fallback a head start. Import only in view.
      timer = window.setTimeout(() => {
        if (typeof window.requestIdleCallback === 'function')
          idle = window.requestIdleCallback(start, { timeout: 1500 });
        else start();
      }, 900);
    }
    function preferences() {
      generation++;
      cancelScheduled();
      if (!allowed()) {
        instance?.dispose();
        instance = undefined;
        setReady(false);
      } else schedule();
    }
    function visibility() {
      instance?.setActive(visible && !document.hidden);
      if (document.hidden) cancelScheduled();
      else schedule();
    }
    // Unsupported observers keep the immediately useful static scene.
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            ([entry]) => {
              visible = entry.isIntersecting;
              instance?.setActive(visible && !document.hidden);
              if (visible) schedule();
              else cancelScheduled();
            },
            { threshold: 0.05 },
          )
        : null;
    observer?.observe(element);
    motion?.addEventListener('change', preferences);
    connection?.addEventListener?.('change', preferences);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      generation++;
      cancelScheduled();
      observer?.disconnect();
      instance?.dispose();
      motion?.removeEventListener('change', preferences);
      connection?.removeEventListener?.('change', preferences);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load]);
  return (
    <div className="hero-desk" data-ready={ready}>
      <div className="hero-desk__stage" aria-hidden="true">
        <StaticHeroScene />
        <div className="hero-desk__canvas" ref={host} />
      </div>
      <p className="hero-desk__caption">
        A little of my world <span>Software · cars · photography</span>
      </p>
    </div>
  );
}
