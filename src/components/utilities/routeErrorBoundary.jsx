import { Component } from 'react';
import { appHref } from '../../util/navigation';

// Messages browsers use when a lazily loaded chunk cannot be fetched or evaluated
// (Chromium, Safari, Firefox): usually a stale page after a deploy, or a dropped connection.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i;

export const isChunkLoadError = (error) => CHUNK_ERROR.test(String(error?.message ?? error));

/**
 * Catches failures while loading or starting a lazily loaded page, so a broken start
 * shows what failed and a Retry instead of a blank screen. Details stay on the device:
 * shown on the page and logged to the console, never uploaded.
 */
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.name}] failed to start`, error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    return (
      <main className="route-error" role="alert">
        <h1>{this.props.name} could not start</h1>
        <p>
          {chunk
            ? 'Part of the page could not be downloaded. This usually means the site was just updated or the connection dropped.'
            : 'An error stopped the page while it was starting.'}
        </p>
        <p className="route-error__detail mono">
          {chunk ? 'Failing operation: loading page code' : 'Failing operation: starting the page'} — {error.name}: {String(error.message).slice(0, 300)}
        </p>
        <div className="route-error__actions">
          <button type="button" onClick={() => window.location.reload()}>Retry</button>
          <a href={appHref(this.props.homePath ?? '/')}>{this.props.homeLabel ?? 'Go to the homepage'}</a>
        </div>
      </main>
    );
  }
}
