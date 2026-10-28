"""Build native JSON/stdin helpers; no user's credentials or library are read."""
import importlib.metadata
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build' / 'helpers'
OUTPUT.mkdir(parents=True, exist_ok=True)

for provider, packages in [('youtube', ['ytmusicapi', 'certifi']),
                           ('spotify', ['spotapi', 'curl_cffi', 'certifi', 'websockets'])]:
    name = provider + '-helper'
    args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console', '--noupx',
            '--name', name, '--paths', str(ROOT / 'integrations'),
            '--distpath', str(OUTPUT), '--workpath', str(ROOT / 'build' / 'pyinstaller' / provider),
            '--specpath', str(ROOT / 'build' / 'specs')]
    for package in packages:
        args.extend(['--collect-all', package])
    args.extend(['--copy-metadata', 'ytmusicapi' if provider == 'youtube' else 'spotapi'])
    args.append(str(ROOT / 'integrations' / provider / 'bridge.py'))
    subprocess.run(args, check=True, cwd=ROOT)
    executable = OUTPUT / name / (name + ('.exe' if sys.platform == 'win32' else ''))
    # Probe imports the actual adapters (including native TLS libraries), offline.
    result = subprocess.run([str(executable)], input=json.dumps({'action': 'probe'}),
                            text=True, capture_output=True, timeout=60, check=True)
    response = json.loads(result.stdout)
    if not response.get('ok') or not response.get('result', {}).get('version'):
        raise RuntimeError(f'{provider} bundled helper failed its offline probe: {response}')
    print(f'{provider} helper probe passed', flush=True)

# Ship installed dependency metadata/licenses beside the helpers.
notices = ['Playlista integration dependencies\nSource: https://github.com/playlista-app/playlista\n']
for dist in sorted(importlib.metadata.distributions(), key=lambda item: item.metadata['Name'].lower()):
    name = dist.metadata['Name']
    notices.append(f"\n{name} {dist.version}\n{dist.metadata.get('Home-page', '')}\n{dist.metadata.get('License', '')}\n")
    for file in dist.files or []:
        if any(part.lower().startswith(('license', 'copying', 'notice')) for part in file.parts):
            try:
                notices.append(dist.locate_file(file).read_text(encoding='utf-8', errors='replace'))
            except (OSError, IsADirectoryError):
                pass
(OUTPUT / 'THIRD_PARTY_NOTICES.txt').write_text('\n'.join(notices), encoding='utf-8')
