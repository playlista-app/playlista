import importlib.util
import io
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

try:
    import spotapi as installed
except ImportError:
    installed = None

spec = importlib.util.spec_from_file_location('spotify_bridge', pathlib.Path(__file__).parents[1] / 'integrations/spotify/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

PLAYLIST_ID = '0123456789abcdefghijkl'
TRACK_ID = 'abcdefghijkl0123456789'
SONG = {'__typename': 'Track', 'uri': 'spotify:track:' + TRACK_ID, 'name': 'In Too Deep', 'artists': {'items': [{'profile': {'name': 'Sum 41'}}]}}


class Client:
    def __init__(self, *args, **kwargs):
        self.closed = False
        self.offsets = []
        self.library = []

    def close(self):
        self.closed = True

    def post(self, url, **kwargs):
        if url == 'https://spclient.wg.spotify.com/playlist/v2/playlist':
            self.created_payload = kwargs['json']
            return types.SimpleNamespace(response='spotify:playlist:' + PLAYLIST_ID)
        variables = json.loads(kwargs['params']['variables'])
        assert variables['flatten'] is True
        assert variables['includeFoldersWhenFlattening'] is False
        offset = variables['offset']
        self.offsets.append(offset)
        return types.SimpleNamespace(response={'data': {'me': {'libraryV3': {'items': self.library[offset:offset + 50], 'totalCount': len(self.library)}}}})


class Login:
    @staticmethod
    def from_cookies(dump, config):
        assert dump['cookies']['sp_dc'] == 'synthetic-secret'
        return types.SimpleNamespace(client=config.client, logged_in=True)


class User:
    def __init__(self, login): pass
    def get_user_info(self): return {'profile': {'username': 'personal', 'display_name': 'Personal'}}


class PrivatePlaylist:
    def __init__(self, login): self.login = login
    def get_library(self, limit):
        assert limit == 50
        return self.login.client.post('https://api-partner.spotify.com', params={'operationName': 'libraryV3', 'variables': json.dumps({'offset': 0, 'flatten': False})}).response
    def create_playlist(self, name):
        self.login.client.post('https://spclient.wg.spotify.com/playlist/v2/playlist', json={'ops': [{'updateListAttributes': {'newAttributes': {'values': {'name': name}}}}]})
        PublicPlaylist.rows = []
        return 'spotify:playlist:' + PLAYLIST_ID
    def set_playlist(self, playlist_id): self.playlist_id = playlist_id


class Song:
    fail = False
    batches = []
    def __init__(self, playlist=None, client=None): self.playlist = playlist
    def query_songs(self, query, limit):
        assert limit == 5
        return {'data': {'searchV2': {'tracksV2': {'items': [] if query == 'Missing' else [{'item': {'data': SONG}}]}}}}
    def add_songs_to_playlist(self, ids):
        if self.fail: raise RuntimeError('Synthetic write failure')
        assert len(ids) <= 50
        self.batches.append(ids)
        PublicPlaylist.rows.extend({'itemV2': {'data': {**SONG, 'uri': 'spotify:track:' + song_id}}} for song_id in ids)


class PublicPlaylist:
    rows = []
    offsets = []
    total_override = None

    def __init__(self, playlist_id, client):
        assert playlist_id == PLAYLIST_ID

    def get_playlist_info(self, limit, offset):
        assert limit == 50
        self.offsets.append(offset)
        return {'data': {'playlistV2': {'name': 'Imported', 'description': '<b>Skate</b> &amp; sing',
                'content': {'items': self.rows[offset:offset + 50], 'totalCount': len(self.rows) if self.total_override is None else self.total_override}}}}


fake = types.SimpleNamespace(TLSClient=Client, Config=lambda **kwargs: types.SimpleNamespace(**kwargs), Login=Login,
                             User=User, PrivatePlaylist=PrivatePlaylist, PublicPlaylist=PublicPlaylist, Song=Song)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.module_patch = patch.dict(sys.modules, {'spotapi': fake})
        self.module_patch.start()
        PublicPlaylist.rows = []
        PublicPlaylist.offsets = []
        PublicPlaylist.total_override = None
        Song.fail = False
        Song.batches = []

    def tearDown(self): self.module_patch.stop()

    def test_cookie_formats_and_filtering(self):
        forms = ['synthetic-secret', 'sp_dc=synthetic-secret; sp_key=other; tracking=drop',
                 'Cookie: sp_dc=synthetic-secret', 'cookie:\nsp_dc=synthetic-secret',
                 json.dumps({'sp_dc': 'synthetic-secret'}), json.dumps({'cookies': {'sp_dc': 'synthetic-secret'}}),
                 json.dumps([{'name': 'sp_dc', 'value': 'synthetic-secret'}]),
                 'fetch("https://open.spotify.com", {"headers":{"cookie":"sp_dc=synthetic-secret"}});']
        for form in forms:
            self.assertEqual(bridge.parse_cookies(form)['sp_dc'], 'synthetic-secret')
            self.assertNotIn('tracking', bridge.parse_cookies(form))
        self.assertEqual(bridge.parse_cookies('synthetic-base64==')['sp_dc'], 'synthetic-base64==')
        for invalid in ['', '{}', 'Cookie: sp_key=only', 'sp_dc=bad\r\nInjected: bad']:
            with self.assertRaises(bridge.UserError): bridge.parse_cookies(invalid)

    def test_account_preview_resolves_actual_user(self):
        result = bridge.execute({'action': 'connect', 'cookies': 'synthetic-secret'})
        self.assertEqual(result['account'], {'id': 'personal', 'name': 'Personal'})
        self.assertEqual(result['auth']['identifier'], 'personal')

    def test_library_pagination_and_folder_flattening(self):
        login = bridge.create_login(fake, {'cookies': {'sp_dc': 'synthetic-secret'}})
        login.client.library = [{'item': {'data': {'__typename': 'Playlist', 'uri': 'spotify:playlist:' + str(i).zfill(22), 'name': str(i)}}} for i in range(63)]
        login.client.library.append({'item': {'data': {'__typename': 'Album', 'uri': 'spotify:album:' + TRACK_ID}}})
        result = bridge.get_playlists(fake, login)
        self.assertEqual(len(result), 63)
        self.assertEqual(login.client.offsets, [0, 50])
        self.assertTrue(all(p['importable'] for p in result))

    def test_large_playlist_preserves_duplicates_skips_unavailable_and_paginates(self):
        PublicPlaylist.rows = [{'itemV2': {'data': SONG}} for _ in range(120)] + [
            {'itemV2': {'data': {**SONG, 'playability': {'playable': False}}}},
            {'itemV2': {'data': {'__typename': 'Episode', 'uri': 'spotify:episode:' + TRACK_ID, 'name': 'Podcast'}}},
            {'itemV2': {'data': {**SONG, 'uri': 'spotify:local:artist:track'}}},
        ]
        result = bridge.execute({'action': 'playlist', 'auth': {'cookies': {'sp_dc': 'synthetic-secret'}}, 'id': PLAYLIST_ID})
        self.assertEqual(len(result['songs']), 120)
        self.assertEqual(result['songs'][0], result['songs'][119])
        self.assertEqual(result['skipped'], 3)
        self.assertEqual(result['description'], 'Skate & sing')
        self.assertEqual(PublicPlaylist.offsets, [0, 50, 100])

    def test_incomplete_playlist_does_not_return_partial_import(self):
        PublicPlaylist.rows = [{'itemV2': {'data': SONG}}]
        PublicPlaylist.total_override = 200
        with self.assertRaisesRegex(bridge.UserError, 'only part'):
            bridge.execute({'action': 'playlist', 'auth': {'cookies': {'sp_dc': 'synthetic-secret'}}, 'id': PLAYLIST_ID})

    def test_search_and_export_batches_preserve_order_duplicates_and_description(self):
        auth = {'cookies': {'sp_dc': 'synthetic-secret'}}
        found = bridge.execute({'action': 'search_batch', 'auth': auth, 'queries': ['In Too Deep', 'Missing']})
        self.assertEqual(found[0]['matches'][0]['id'], TRACK_ID)
        self.assertEqual(found[1]['matches'], [])
        login = bridge.create_login(fake, auth)
        ids = [TRACK_ID] * 101
        result = bridge.export_playlist(fake, login, {'name': 'Test', 'description': 'Description', 'ids': ids})
        self.assertTrue(result['complete'])
        self.assertEqual(result['added'], 101)
        self.assertEqual([len(batch) for batch in Song.batches], [50, 50, 1])
        values = login.client.created_payload['ops'][0]['updateListAttributes']['newAttributes']['values']
        self.assertEqual(values['description'], 'Description')

    def test_partial_export_keeps_a_linkable_playlist_id(self):
        Song.fail = True
        result = bridge.execute({'action': 'create', 'auth': {'cookies': {'sp_dc': 'synthetic-secret'}}, 'name': 'Test', 'ids': [TRACK_ID]})
        self.assertFalse(result['complete'])
        self.assertEqual(result['id'], PLAYLIST_ID)

    def test_raw_exception_does_not_expose_cookie(self):
        output = io.StringIO()
        with patch.object(bridge, 'create_login', side_effect=RuntimeError('Cookie: synthetic-secret')), patch.object(sys, 'stdin', io.StringIO(json.dumps({'action': 'connect', 'cookies': 'synthetic-secret'}))), patch.object(sys, 'stdout', output):
            bridge.main()
        self.assertFalse(json.loads(output.getvalue())['ok'])
        self.assertNotIn('synthetic-secret', output.getvalue())

    @unittest.skipIf(installed is None, 'Run setup:spotify for installed-library contract checks.')
    def test_real_library_accepts_cookie_config_without_network(self):
        login = bridge.create_login(installed, {'cookies': {'sp_dc': 'synthetic-secret'}})
        try:
            self.assertTrue(login.logged_in)
            self.assertEqual(login.client.cookies.get_dict()['sp_dc'], 'synthetic-secret')
            self.assertIsNone(login.solver)
        finally:
            login.client.close()


if __name__ == '__main__': unittest.main()
