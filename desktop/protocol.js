const APP_URL = 'playlista://app/';

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'playlista:' && url.hostname === 'app' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function isExternalUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

function createProtocolHandler(origin, requestBackend = fetch) {
  return async (request) => {
    if (!isAppUrl(request.url) || !['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Not allowed', { status: 403 });
    const source = new URL(request.url);
    const target = new URL(origin);
    target.pathname = source.pathname;
    target.search = source.search;
    const headers = new Headers({ origin });
    for (const key of ['content-type', 'accept']) {
      if (request.headers.has(key)) headers.set(key, request.headers.get(key));
    }
    const response = await requestBackend(target, {
      method: request.method, headers, redirect: 'error', signal: request.signal,
      ...(request.method === 'POST' ? { body: request.body, duplex: 'half' } : {}),
    });
    const outgoing = new Headers(response.headers);
    outgoing.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return new Response(response.body, { status: response.status, headers: outgoing });
  };
}

module.exports = { APP_URL, isAppUrl, isExternalUrl, createProtocolHandler };
