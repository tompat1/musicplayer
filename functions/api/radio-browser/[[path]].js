const RADIO_BROWSER_BASE_URLS = [
  'https://all.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=180',
};

const getPath = (params) => {
  const path = params?.path;
  if (Array.isArray(path)) return path.join('/');
  return String(path || '');
};

const getUpstreamPath = (path) => {
  if (path === 'stations/search') return '/json/stations/search';
  if (/^url\/[-a-f0-9]+$/i.test(path)) return `/json/${path}`;
  return '';
};

const fetchFromRadioBrowser = async (upstreamPath, searchParams) => {
  let lastError = null;

  for (const baseUrl of RADIO_BROWSER_BASE_URLS) {
    const upstreamUrl = new URL(upstreamPath, baseUrl);
    searchParams.forEach((value, key) => upstreamUrl.searchParams.append(key, value));

    try {
      const response = await fetch(upstreamUrl.toString(), {
        headers: {
          accept: 'application/json',
          'x-application': 'musicplayer/0.1.0',
        },
      });

      if (!response.ok) {
        lastError = new Error(`Radio Browser returned ${response.status}`);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Radio Browser could not be reached');
};

export async function onRequestGet({ request, params }) {
  const requestUrl = new URL(request.url);
  const upstreamPath = getUpstreamPath(getPath(params));

  if (!upstreamPath) {
    return Response.json({ error: 'Unknown Radio Browser endpoint' }, { status: 404, headers: JSON_HEADERS });
  }

  try {
    const response = await fetchFromRadioBrowser(upstreamPath, requestUrl.searchParams);
    return new Response(response.body, {
      status: response.status,
      headers: JSON_HEADERS,
    });
  } catch {
    return Response.json(
      { error: 'Radio Browser could not be reached. Try again in a moment.' },
      { status: 502, headers: JSON_HEADERS },
    );
  }
}
