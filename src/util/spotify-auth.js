const http = require('http');
const { exec } = require('child_process');

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

const redirectUri = 'http://127.0.0.1:5173/callback';
const scope = 'user-read-recently-played';

if (!clientId || !clientSecret) {
  console.error(
    'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET first.'
  );
  process.exit(1);
}

const authUrl =
  'https://accounts.spotify.com/authorize?' +
  new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope,
    redirect_uri: redirectUri
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('Missing authorization code');
    return;
  }

  try {
    const tokenResponse = await fetch(
      'https://accounts.spotify.com/api/token',
      {
        method: 'POST',
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(`${clientId}:${clientSecret}`).toString(
              'base64'
            ),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      }
    );

    const data = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error(data);
      res.writeHead(500);
      res.end('Spotify token exchange failed');
      return;
    }

    console.log('\nRefresh token:\n');
    console.log(data.refresh_token);

    res.writeHead(200, {
      'Content-Type': 'text/plain'
    });
    res.end(
      'Authorization complete. You can close this window.'
    );
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end('Authorization failed');
  } finally {
    setTimeout(() => server.close(), 1000);
  }
});

server.listen(5173, '127.0.0.1', () => {
  console.log(`Authorize here:\n${authUrl}\n`);

  const command =
    process.platform === 'win32'
      ? `start "" "${authUrl}"`
      : process.platform === 'darwin'
        ? `open "${authUrl}"`
        : `xdg-open "${authUrl}"`;

  exec(command);
});