"""Local SpotAPI adapter. Credentials travel on stdin; stdout is sanitized JSON."""
import contextlib
import copy
import html
import io
import json
import re
import sys
from importlib.metadata import version
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_common import UserError, protect

PAGE_SIZE = 50
MAX_SONGS = 10000


def parse_cookies(raw):
    text = str(raw).strip()
    try:
        value = json.loads(text)
    except ValueError:
        match = re.search(r'["\']headers["\']\s*:\s*(\{)', text)
        if match:
            try:
                value, _ = json.JSONDecoder().raw_decode(text[match.start(1):])
            except ValueError:
                value = text
        else:
            value = text
    if isinstance(value, dict):
        value = value.get('cookies', value.get('headers', value))
    if isinstance(value, list):
        value = {item.get('name'): item.get('value') for item in value if isinstance(item, dict)}
    if isinstance(value, dict):
        value = {str(key).lower(): item for key, item in value.items()}
        value = value.get('cookie', value)
    if isinstance(value, str):
        header = re.search(r'(?im)^cookie\s*:\s*(?:\n\s*)?([^\r\n]+)', value)
        if header:
            value = header.group(1)
        if re.fullmatch(r'[A-Za-z0-9._~%+/-]+={0,2}', value):
            value = {'sp_dc': value}
        else:
            value = dict((key.strip(), val.strip()) for part in value.split(';')
                         if '=' in part for key, val in [part.strip().split('=', 1)])
    if not isinstance(value, dict):
        raise UserError('Paste the sp_dc cookie value, a Cookie header, or cookies JSON.')
    cookies = {key: val.strip() for key, val in value.items() if key in {'sp_dc', 'sp_key'} and isinstance(val, str)}
    if not cookies.get('sp_dc') or any(re.search(r'[\s;\r\n]', val) for val in cookies.values()):
        raise UserError('A valid sp_dc cookie is required. Copy it from the signed-in Spotify web player.')
    return cookies


class SilentLogger:
    @staticmethod
    def info(*args, **kwargs): pass
    @staticmethod
    def attempt(*args, **kwargs): pass
    @staticmethod
    def error(*args, **kwargs): pass
    @staticmethod
    def fatal(*args, **kwargs): pass


def create_login(spotapi, auth):
    class BrowserClient(spotapi.TLSClient):
        library_offset = 0
        playlist_description = ''

        def post(self, url, **kwargs):
            # SpotAPI 1.2.8 hardcodes offset=0 and excludes folder contents.
            # Keep its query/hash/auth handling and adapt just pagination variables.
            params = kwargs.get('params')
            if isinstance(params, dict) and params.get('operationName') == 'libraryV3':
                params = dict(params)
                variables = json.loads(params['variables'])
                variables.update({'offset': self.library_offset, 'flatten': True, 'includeFoldersWhenFlattening': False})
                params['variables'] = json.dumps(variables)
                kwargs['params'] = params
            kwargs.setdefault('timeout', 30)
            if url == 'https://spclient.wg.spotify.com/playlist/v2/playlist' and self.playlist_description:
                payload = copy.deepcopy(kwargs.get('json') or {})
                for operation in payload.get('ops', []):
                    attributes = operation.get('updateListAttributes', {}).get('newAttributes', {}).get('values')
                    if isinstance(attributes, dict):
                        attributes['description'] = self.playlist_description
                kwargs['json'] = payload
            response = super().post(url, **kwargs)
            if isinstance(response.response, dict) and response.response.get('errors'):
                raise UserError('Spotify rejected the playlist request. Try again later or reconnect this account.')
            return response

        def get(self, url, **kwargs):
            kwargs.setdefault('timeout', 30)
            return super().get(url, **kwargs)

    client = BrowserClient('chrome120', '', auto_retries=1)
    config = spotapi.Config(logger=SilentLogger, client=client, solver=None)
    login = spotapi.Login.from_cookies({'identifier': auth.get('identifier') or 'playlista', 'cookies': auth['cookies']}, config)
    return login


def unwrap(item):
    for _ in range(8):
        if not isinstance(item, dict):
            return {}
        nested = next((item[key] for key in ('itemV2', 'item', 'data', 'track') if isinstance(item.get(key), dict)), None)
        if nested is None:
            return item
        item = nested
    return item if isinstance(item, dict) else {}


def library_content(response):
    data = response.get('data') or {}
    content = (data.get('me') or {}).get('libraryV3') or data.get('libraryV3')
    if not isinstance(content, dict) or not isinstance(content.get('items'), list):
        raise UserError('Spotify returned an unsupported library response. No playlists were imported.')
    if not isinstance(content.get('totalCount'), int):
        raise UserError('Spotify did not return a library count. Load the library again.')
    return content


def get_playlists(spotapi, login):
    api = spotapi.PrivatePlaylist(login)
    playlists = []
    seen = set()
    offset = 0
    while True:
        login.client.library_offset = offset
        content = library_content(api.get_library(PAGE_SIZE))
        rows = content['items']
        for row in rows:
            item = unwrap(row)
            uri = item.get('uri', '')
            if item.get('__typename') not in (None, 'Playlist') or not re.fullmatch(r'spotify:playlist:[A-Za-z0-9]{22}', uri):
                continue
            playlist_id = uri.rsplit(':', 1)[1]
            if playlist_id in seen:
                continue
            seen.add(playlist_id)
            playlists.append({'id': playlist_id, 'name': item.get('name') or 'Untitled playlist',
                              'total': (item.get('content') or {}).get('totalCount'), 'importable': True})
        offset += len(rows)
        if offset >= content['totalCount']:
            return playlists
        if not rows or offset > 50000:
            raise UserError('Spotify did not return the complete library. Try loading it again.')


def track(item):
    item = unwrap(item)
    uri = item.get('uri', '')
    if item.get('__typename') not in (None, 'Track') or not re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}', uri):
        return None
    if item.get('isLocal') or item.get('isPlayable') is False or (item.get('playability') or {}).get('playable') is False:
        return None
    title = item.get('name')
    if not isinstance(title, str) or not title.strip():
        return None
    artists = item.get('artists') or {}
    if isinstance(artists, dict):
        artists = artists.get('items', [])
    names = []
    for artist in artists:
        artist = unwrap(artist)
        name = (artist.get('profile') or {}).get('name') or artist.get('name')
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    return {'title': title.strip(), 'artist': ', '.join(names)}


def get_playlist(spotapi, login, playlist_id, with_ids=False):
    api = spotapi.PublicPlaylist(playlist_id, client=login.client)
    songs = []
    ids = []
    skipped = 0
    offset = 0
    name = description = ''
    expected_total = None
    while True:
        response = api.get_playlist_info(limit=PAGE_SIZE, offset=offset)
        playlist = (response.get('data') or {}).get('playlistV2')
        if not isinstance(playlist, dict) or not isinstance(playlist.get('content'), dict):
            raise UserError('Spotify did not return playlist tracks. Check its URL and your account access.')
        content = playlist['content']
        if not isinstance(content.get('items'), list) or not isinstance(content.get('totalCount'), int):
            raise UserError('Spotify returned an unsupported playlist response. Nothing was imported.')
        total = content['totalCount']
        if total > MAX_SONGS:
            raise UserError('A single import is limited to 10,000 songs.')
        if expected_total is not None and total != expected_total:
            raise UserError('The Spotify playlist changed during import. Import it again for a complete copy.')
        expected_total = total
        if offset == 0:
            name = playlist.get('name') or 'Spotify playlist'
            description = html.unescape(re.sub(r'<[^>]*>', '', playlist.get('description') or ''))
        rows = content['items']
        for row in rows:
            uri = unwrap(row).get('uri', '')
            if re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}', uri):
                ids.append(uri.rsplit(':', 1)[1])
            song = track(row)
            if song:
                songs.append(song)
            else:
                skipped += 1
        offset += len(rows)
        if offset >= total:
            return {'name': name, 'description': description, 'songs': songs, 'skipped': skipped, **({'ids': ids} if with_ids else {})}
        if not rows:
            raise UserError('Spotify returned only part of this playlist. Nothing was imported. Try again.')


def search_song(api, query):
    response = api.query_songs(query, limit=5)
    tracks = ((response.get('data') or {}).get('searchV2') or {}).get('tracksV2')
    if not isinstance(tracks, dict) or not isinstance(tracks.get('items'), list):
        raise UserError('Spotify returned an unsupported search response.')
    for item in tracks['items']:
        parsed = track(item)
        if parsed:
            data = unwrap(item)
            return [{**parsed, 'id': data['uri'].rsplit(':', 1)[1],
                     'album': (data.get('albumOfTrack') or data.get('album') or {}).get('name', ''), 'duration': ''}]
    return []


def export_playlist(spotapi, login, request):
    api = spotapi.PrivatePlaylist(login)
    login.client.playlist_description = request.get('description', '')
    uri = api.create_playlist(request['name'])
    match = re.fullmatch(r'(?:spotify:playlist:)?([A-Za-z0-9]{22})', str(uri))
    if not match:
        raise UserError('Spotify did not confirm playlist creation. Check your library before retrying.')
    playlist_id = match.group(1)
    added = 0
    try:
        api.set_playlist(playlist_id)
        songs = spotapi.Song(playlist=api)
        for offset in range(0, len(request['ids']), 50):
            batch = request['ids'][offset:offset + 50]
            songs.add_songs_to_playlist(batch)
            added += len(batch)
        actual = get_playlist(spotapi, login, playlist_id, with_ids=True)['ids']
        if actual != request['ids']:
            raise UserError('Spotify returned a different track list.')
        return {'id': playlist_id, 'added': added, 'complete': True}
    except Exception:
        return {'id': playlist_id, 'added': added, 'complete': False,
                'warning': 'Spotify export could not be fully verified. Open the created playlist to inspect its tracks before trying another export.'}


def execute(request):
    action = request.get('action')
    if action in ('seal', 'unseal'):
        return protect(request['value'], action == 'unseal')
    try:
        import spotapi
    except ImportError:
        raise UserError('Spotify needs SpotAPI and its dependencies. Run npm run setup:spotify, then try again.')
    if action == 'probe':
        return {'version': version('spotapi')}
    auth = {'cookies': parse_cookies(request.get('cookies', ''))} if action == 'connect' else request.get('auth')
    if not auth or not auth.get('cookies', {}).get('sp_dc'):
        raise UserError('Connect Spotify in Settings first.')
    login = create_login(spotapi, auth)
    try:
        if action == 'connect':
            profile = spotapi.User(login).get_user_info().get('profile') or {}
            identifier = profile.get('username')
            if not isinstance(identifier, str) or not identifier.strip():
                raise UserError('Spotify did not identify this account. Copy a fresh cookie and try again.')
            name = profile.get('display_name') or profile.get('displayName') or identifier
            return {'auth': {**auth, 'identifier': identifier}, 'account': {'id': identifier, 'name': name}}
        if action == 'playlists':
            return get_playlists(spotapi, login)
        if action == 'playlist':
            playlist_id = str(request.get('id') or '')
            if not re.fullmatch(r'[A-Za-z0-9]{22}', playlist_id):
                raise UserError('Choose a valid Spotify playlist.')
            return get_playlist(spotapi, login, playlist_id)
        if action in ('search', 'search_batch'):
            api = spotapi.Song(client=login.client)
            if action == 'search':
                return search_song(api, request['query'])
            results = []
            for query in request['queries']:
                try:
                    item = {'query': query, 'matches': search_song(api, query)}
                except Exception:
                    item = {'query': query, 'matches': [], 'error': 'Spotify search failed. Try exporting again later.'}
                results.append(item)
                if request.get('progress'):
                    sys.__stdout__.write(json.dumps({'progress': item}, ensure_ascii=True) + '\n')
                    sys.__stdout__.flush()
            return results
        if action == 'create':
            ids = request.get('ids')
            if not isinstance(ids, list) or not ids or any(not re.fullmatch(r'[A-Za-z0-9]{22}', str(item)) for item in ids):
                raise UserError('Choose valid Spotify track matches before exporting.')
            return export_playlist(spotapi, login, request)
        raise UserError('Unknown Spotify operation.')
    finally:
        login.client.close()


def main():
    try:
        request = json.load(sys.stdin)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = execute(request)
        response = {'ok': True, 'result': result}
    except UserError as error:
        response = {'ok': False, 'error': str(error)}
    except Exception:
        response = {'ok': False, 'error': 'Spotify could not complete this request. Copy a fresh browser cookie and reconnect, or try again later. SpotAPI may need an update if Spotify has changed.'}
    sys.stdout.write(json.dumps(response, ensure_ascii=True))


if __name__ == '__main__':
    main()
