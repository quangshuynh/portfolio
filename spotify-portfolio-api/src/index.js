/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const SPOTIFY_TOKEN_URL =
  'https://accounts.spotify.com/api/token';

const SPOTIFY_RECENT_URL =
  'https://api.spotify.com/v1/me/player/recently-played?limit=6';

const ALLOWED_ORIGINS = new Set([
  'https://quangshuynh.github.io',
  'https://quangs.vercel.app',
  'https://quanghuynh.com',
  'https://www.quanghuynh.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

async function getAccessToken(env) {
  const credentials = btoa(
    `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`
  );

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.SPOTIFY_REFRESH_TOKEN
    })
  });

  if (!response.ok) {
    throw new Error(
      `Spotify token refresh failed: ${response.status}`
    );
  }

  return response.json();
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');

  return {
    ...(ALLOWED_ORIGINS.has(origin)
      ? { 'Access-Control-Allow-Origin': origin }
      : {}),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    if (
      request.method !== 'GET' ||
      url.pathname !== '/recent'
    ) {
      return new Response('Not found', {
        status: 404,
        headers: corsHeaders(request)
      });
    }

    try {
      const { access_token } = await getAccessToken(env);

      const response = await fetch(SPOTIFY_RECENT_URL, {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });

      if (!response.ok) {
        throw new Error(
          `Spotify recent tracks failed: ${response.status}`
        );
      }

      const data = await response.json();

      const tracks = data.items.map(({ track, played_at }) => ({
        id: track.id,
        name: track.name,
        artist: track.artists
          .map((artist) => artist.name)
          .join(', '),
        album: track.album.name,
        image: track.album.images?.[0]?.url ?? null,
        url: track.external_urls.spotify,
        playedAt: played_at
      }));

      return Response.json(
        { tracks },
        {
          headers: {
            ...corsHeaders(request),
            'Cache-Control':
              'public, max-age=300, s-maxage=300'
          }
        }
      );
    } catch (error) {
      console.error(error);

      return Response.json(
        { error: 'Unable to load listening activity' },
        {
          status: 502,
          headers: corsHeaders(request)
        }
      );
    }
  }
};