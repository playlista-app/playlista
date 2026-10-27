"""Network-free contract tests for the Python adapter; invoked by node --test."""
import importlib.util
import io
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

try:
    import ytmusicapi as installed_library
except ImportError:
    installed_library = None

spec = importlib.util.spec_from_file_location('bridge', pathlib.Path(__file__).parents[1] / 'integrations/youtube/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

HEADERS = {'Cookie': '__Secure-3PAPISID=synthetic', 'Authorization': 'SAPISIDHASH synthetic', 'X-Goog-AuthUser': '1'}


class FakeAPI:
    def __init__(self, **kwargs):
        self.ids = []
        self.fail = False
        self.auth = kwargs

    def get_account_info(self):
        return {'accountName': 'Test account', 'channelHandle': '@test'}

    def search(self, query, filter, limit):
        assert filter == 'songs'
        assert limit == 1
        if query == 'Error':
            raise RuntimeError('synthetic credential must not appear in errors')
        return [{'videoId': 'abcdefghijk', 'title': query, 'artists': [{'name': 'First artist'}]},
                {'videoId': 'mnopqrstuvw', 'title': query, 'artists': [{'name': 'Second artist'}]}]

    def get_library_playlists(self, limit):
        assert limit is None
        return [{'playlistId': 'PLexample', 'title': 'Test', 'count': '3'}]

    def get_playlist(self, playlist_id, limit):
        assert limit is None
        if self.ids:
            return {'tracks': [{'videoId': video} for video in self.ids]}
        return {'title': 'Imported', 'description': 'Description', 'tracks': [
            {'videoId': 'abcdefghijk', 'title': 'Track', 'artists': [{'name': 'Artist'}]},
            {'videoId': 'abcdefghijk', 'title': 'Track', 'artists': [{'name': 'Artist'}]},
            {'videoId': 'unavailable', 'title': 'Missing', 'isAvailable': False},
            {'videoId': 'podcast', 'title': 'Episode', 'resultType': 'episode'},
        ]}

    def create_playlist(self, title, description, privacy_status):
        assert privacy_status == 'PRIVATE'
        return 'PLcreated'

    def add_playlist_items(self, playlist_id, batch, duplicates):
        assert duplicates is True
        assert len(batch) <= 50
        if self.fail:
            raise RuntimeError('synthetic cookie should not be exposed')
        self.ids.extend(batch)
        return {'status': 'STATUS_SUCCEEDED'}


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeAPI()
        self.options = None

        def create(**kwargs):
            self.options = kwargs
            return self.api

        sys.modules['ytmusicapi'] = types.SimpleNamespace(YTMusic=create, __version__='1.12.3')

    def tearDown(self):
        if installed_library:
            sys.modules['ytmusicapi'] = installed_library
        else:
            sys.modules.pop('ytmusicapi', None)

    @unittest.skipIf(installed_library is None, 'Install ytmusicapi for the package contract check.')
    def test_installed_library_accepts_headers_without_network(self):
        headers = bridge.parse_headers(json.dumps({**HEADERS, 'X-Goog-Visitor-Id': 'synthetic-visitor'}))
        # A visitor ID prevents the constructor from making a visitor discovery request.
        api = installed_library.YTMusic(auth=headers, user=None)
        self.assertTrue(api.headers['authorization'].startswith('SAPISIDHASH '))
        self.assertEqual(api.headers['x-origin'], 'https://music.youtube.com')

    def test_header_formats(self):
        formats = [json.dumps(HEADERS), '\n'.join(f'{k}: {v}' for k, v in HEADERS.items()),
                   '\n'.join(f'{k}:\n{v}' for k, v in HEADERS.items()),
                   '\n'.join(f'{k}\n{v}' for k, v in HEADERS.items()),
                   f'fetch("https://music.youtube.com", {{"headers": {json.dumps(HEADERS)}, "body": "..."}});']
        for raw in formats:
            parsed = bridge.parse_headers(raw)
            self.assertEqual(parsed['cookie'], HEADERS['Cookie'])
            self.assertEqual(parsed['x-origin'], 'https://music.youtube.com')
            self.assertEqual(parsed['x-goog-authuser'], '1')
        with self.assertRaises(bridge.UserError):
            bridge.parse_headers('Cookie: nope')

    def test_account_and_import(self):
        result = bridge.execute({'action': 'connect', 'headers': json.dumps(HEADERS)})
        self.assertEqual(result['account']['name'], 'Test account')
        self.assertNotIn('requests_timeout', self.options)
        result = bridge.execute({'action': 'playlist', 'auth': HEADERS, 'id': 'PLexample'})
        self.assertEqual([song['title'] for song in result['songs']], ['Track', 'Track'])
        self.assertEqual(result['skipped'], 2)

    def test_export_batches_duplicates_and_verifies(self):
        ids = ['abcdefghijk'] * 101
        result = bridge.execute({'action': 'create', 'auth': HEADERS, 'name': 'Test', 'ids': ids})
        self.assertTrue(result['complete'])
        self.assertEqual(self.api.ids, ids)
        self.assertEqual(result['added'], 101)

    def test_search_batch_reuses_instance_and_returns_first_results(self):
        result = bridge.execute({'action': 'search_batch', 'auth': HEADERS, 'queries': ['Basket Case', 'Error']})
        self.assertEqual(len(result[0]['matches']), 1)
        self.assertEqual(result[0]['matches'][0]['artist'], 'First artist')
        self.assertEqual(result[1]['matches'], [])
        self.assertNotIn('synthetic credential', json.dumps(result))

    def test_batch_protocol_streams_progress_then_final_response_without_credentials(self):
        output = io.StringIO()
        request = {'action': 'search_batch', 'auth': HEADERS, 'queries': ['Basket Case', 'Error'], 'progress': True}
        with patch.object(sys, 'stdin', io.StringIO(json.dumps(request))), patch.object(sys, 'stdout', output), patch.object(sys, '__stdout__', output):
            bridge.main()
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([message['progress']['query'] for message in messages[:-1]], ['Basket Case', 'Error'])
        self.assertTrue(messages[-1]['ok'])
        self.assertEqual(len(messages[-1]['result']), 2)
        self.assertNotIn('synthetic', output.getvalue())

    def test_partial_export_returns_inspectable_playlist(self):
        self.api.fail = True
        result = bridge.execute({'action': 'create', 'auth': HEADERS, 'name': 'Test', 'ids': ['abcdefghijk']})
        self.assertFalse(result['complete'])
        self.assertEqual(result['id'], 'PLcreated')
        self.assertNotIn('cookie', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
