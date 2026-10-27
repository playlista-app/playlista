"""One JSON request on stdin, one JSON response on stdout. Never log credentials."""
import base64
import contextlib
import ctypes
import io
import json
import re
import sys


class UserError(Exception):
    pass


def protect(value, decrypt=False):
    """Windows DPAPI: ciphertext is bound to the current OS user, no local key file."""
    if sys.platform != 'win32':
        raise UserError('Remembering a connection is only supported on Windows. Connect for this session instead.')
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_char))]

    raw = base64.b64decode(value, validate=True) if decrypt else json.dumps(value).encode('utf-8')
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise UserError('Windows could not unlock the saved YouTube Music connection. Reconnect this account.')
    try:
        result = ctypes.string_at(target.data, target.size)
        return json.loads(result.decode('utf-8')) if decrypt else base64.b64encode(result).decode('ascii')
    finally:
        kernel.LocalFree(ctypes.cast(target.data, ctypes.c_void_p))


def parse_headers(raw):
    # Accept the documented browser.json object or raw copied request headers.
    # No evaluation of pasted JavaScript, curl commands, or shell expressions.
    try:
        headers = json.loads(raw)
    except (ValueError, TypeError):
        headers = {}
        # Chrome's Copy as fetch (Node.js) uses a JSON headers object. Decode
        # that object only; never execute the copied code.
        fetch_headers = re.search(r'["\']headers["\']\s*:\s*(\{)', str(raw))
        if fetch_headers:
            try:
                headers, _ = json.JSONDecoder().raw_decode(str(raw)[fetch_headers.start(1):])
            except ValueError:
                pass
        pending_key = None
        for line in str(raw).splitlines():
            match = re.match(r'^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$', line.strip())
            if match:
                if match.group(2):
                    headers[match.group(1)] = match.group(2)
                    pending_key = None
                else:
                    pending_key = match.group(1)
            elif pending_key:
                headers[pending_key] = line.strip()
                pending_key = None
            elif re.fullmatch(r'[A-Za-z][A-Za-z0-9-]*', line.strip()):
                pending_key = line.strip()
    if not isinstance(headers, dict):
        raise UserError('Paste request headers or a browser.json JSON object.')
    if isinstance(headers.get('headers'), dict):
        headers = headers['headers']
    allowed = {'cookie', 'authorization', 'x-goog-authuser', 'x-goog-visitor-id', 'x-goog-pageid',
               'x-youtube-client-name', 'x-youtube-client-version'}
    cleaned = {key.lower(): value.strip() for key, value in headers.items()
               if isinstance(key, str) and key.lower() in allowed and isinstance(value, str)}
    if not cleaned.get('cookie') or not cleaned.get('authorization'):
        raise UserError('The request headers must include Cookie and Authorization from a signed-in YouTube Music request.')
    if not re.search(r'(?:^|;\s*)__Secure-3PAPISID=', cleaned['cookie']):
        raise UserError('These cookies do not contain a signed-in YouTube Music session. Copy headers from an authenticated /browse request.')
    cleaned.update({'accept': '*/*', 'content-type': 'application/json', 'x-origin': 'https://music.youtube.com'})
    return cleaned


def song(item):
    return {'id': item.get('videoId'), 'title': item.get('title') or '',
            'artist': ', '.join(a.get('name', '') for a in item.get('artists', []) if a.get('name')),
            'album': (item.get('album') or {}).get('name', ''), 'duration': item.get('duration') or ''}


def execute(request):
    action = request.get('action')
    if action == 'seal':
        return protect(request['value'])
    if action == 'unseal':
        return protect(request['value'], True)
    try:
        import ytmusicapi
    except ImportError:
        raise UserError('YouTube Music needs ytmusicapi. Run npm run setup:youtube, then try again.')
    if action == 'probe':
        return {'version': ytmusicapi.__version__}
    headers = parse_headers(request.get('headers', '')) if action == 'connect' else request.get('auth')
    if not headers:
        raise UserError('Connect YouTube Music in Settings first.')
    api = ytmusicapi.YTMusic(auth=headers, user=headers.get('x-goog-pageid'))
    if action == 'connect':
        account = api.get_account_info()
        if not account.get('accountName'):
            raise UserError('YouTube Music did not identify this account. Copy fresh request headers and try again.')
        return {'auth': headers, 'account': {'name': account['accountName'], 'handle': account.get('channelHandle', '')}}
    if action == 'playlists':
        return [{'id': p['playlistId'], 'name': p.get('title') or 'Untitled playlist', 'count': p.get('count', '')}
                for p in api.get_library_playlists(limit=None) if p.get('playlistId')]
    if action == 'playlist':
        playlist = api.get_playlist(request['id'], limit=None)
        tracks = playlist.get('tracks', [])
        songs = [song(t) for t in tracks if t.get('videoId') and t.get('title') and t.get('isAvailable') is not False
                 and t.get('resultType') != 'episode' and 'PODCAST' not in str(t.get('videoType', ''))]
        return {'name': playlist.get('title', ''), 'description': playlist.get('description', ''),
                'songs': songs, 'skipped': len(tracks) - len(songs)}
    if action == 'search':
        return [song(t) for t in api.search(request['query'], filter='songs', limit=8)
                if t.get('videoId') and t.get('title')][:8]
    if action == 'search_batch':
        results = []
        for query in request['queries']:
            try:
                matches = [song(t) for t in api.search(query, filter='songs', limit=1)
                           if t.get('videoId') and t.get('title')][:1]
                item = {'query': query, 'matches': matches}
            except Exception:
                item = {'query': query, 'matches': [], 'error': 'YouTube Music search failed. Try exporting again later.'}
            results.append(item)
            if request.get('progress'):
                sys.__stdout__.write(json.dumps({'progress': item}, ensure_ascii=True) + '\n')
                sys.__stdout__.flush()
        return results
    if action == 'create':
        # Create first, then add in batches with duplicates enabled. Return the remote
        # ID even on a partial failure so the user can inspect it rather than retry blindly.
        playlist_id = api.create_playlist(request['name'], request.get('description', ''), privacy_status='PRIVATE')
        if not isinstance(playlist_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', playlist_id):
            raise UserError('YouTube Music did not confirm playlist creation. Check your library before retrying.')
        added = 0
        try:
            ids = request['ids']
            for offset in range(0, len(ids), 50):
                batch = ids[offset:offset + 50]
                result = api.add_playlist_items(playlist_id, batch, duplicates=True)
                if not isinstance(result, dict) or result.get('status') != 'STATUS_SUCCEEDED':
                    raise UserError('YouTube Music did not confirm the added tracks.')
                added += len(batch)
            # Verify order and multiplicity instead of claiming success on an incomplete write.
            actual = [t.get('videoId') for t in api.get_playlist(playlist_id, limit=None).get('tracks', [])]
            if actual != ids:
                raise UserError('YouTube Music returned a different track list. Inspect the playlist before retrying.')
            return {'id': playlist_id, 'added': added, 'complete': True}
        except Exception:
            return {'id': playlist_id, 'added': added, 'complete': False,
                    'warning': 'Export could not be fully verified. Open the created playlist to inspect its tracks before trying another export.'}
    raise UserError('Unknown YouTube Music operation.')


def main():
    try:
        request = json.load(sys.stdin)
        # Third party diagnostics may contain request headers. Discard them.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = execute(request)
        response = {'ok': True, 'result': result}
    except UserError as error:
        response = {'ok': False, 'error': str(error)}
    except Exception:
        response = {'ok': False, 'error': 'YouTube Music could not complete the request. Check your connection or reconnect with fresh browser headers. If exporting, check YouTube Music before retrying.'}
    sys.stdout.write(json.dumps(response, ensure_ascii=True))


if __name__ == '__main__':
    main()
