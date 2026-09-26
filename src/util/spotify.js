// Shared, lazy Spotify listening cache. Nothing here fetches until a caller
// explicitly asks for tracks (the listening panel); the rotating disc only
// reads whatever is already cached.
export const SPOTIFY_ENDPOINT = 'https://spotify-portfolio-api.quangs.workers.dev/recent';
export const SPOTIFY_PROFILE = 'https://open.spotify.com/user/foahrtqqvuuvt7wscxub4uerd';
const SPOTIFY_CACHE_TTL = 5 * 60 * 1000;

let spotifyTracksCache = null;
let spotifyTracksCachedAt = null;
let spotifyRequest = null;
const listeners = new Set();

export function getFreshSpotifyTracksCache() {
  if (spotifyTracksCache === null || spotifyTracksCachedAt === null) return null;
  return Date.now() - spotifyTracksCachedAt < SPOTIFY_CACHE_TTL
    ? spotifyTracksCache
    : null;
}

export function getSpotifyTracks() {
  const cachedTracks = getFreshSpotifyTracksCache();
  if (cachedTracks) return Promise.resolve(cachedTracks);
  if (!spotifyRequest) {
    spotifyRequest = fetch(SPOTIFY_ENDPOINT)
      .then((response) => {
        if (!response.ok) throw new Error('Spotify request failed');
        return response.json();
      })
      .then((data) => {
        spotifyTracksCache = data.tracks ?? [];
        spotifyTracksCachedAt = Date.now();
        listeners.forEach((listener) => listener(spotifyTracksCache));
        return spotifyTracksCache;
      })
      .finally(() => { spotifyRequest = null; });
  }
  return spotifyRequest;
}

export function clearSpotifyCache() {
  spotifyTracksCache = null;
  spotifyTracksCachedAt = null;
  spotifyRequest = null;
}

/** Notifies when a fetch triggered elsewhere fills the cache. */
export function subscribeSpotifyTracks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
