"""Download and pack geoBoundaries gbOpen ADM2, with ADM1 where ADM2 is unavailable.

Requires curl. Run from the repository root. Keeps the Kartverket/Etalab datasets
and the existing US county dataset. Source downloads are cached under .cache/.
"""
import concurrent.futures
import gzip
import hashlib
import json
import subprocess
from pathlib import Path

CACHE = Path('.cache/geoboundaries')
OUTPUT = Path('public/areas')
MANIFEST = Path('src/data/area-datasets.json')
API = 'https://www.geoboundaries.org/api/current/gbOpen/ALL/ALL/'


def download(url, path):
    subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '90', url, '-o', str(path)], check=True)


def read_sources():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    metadata = CACHE / 'metadata.json'
    countries = CACHE / 'countryInfo.txt'
    if not metadata.exists():
        download(API, metadata)
    if not countries.exists():
        download('https://download.geonames.org/export/dump/countryInfo.txt', countries)
    codes = {}
    for line in countries.read_text().splitlines():
        if line and not line.startswith('#'):
            fields = line.split('\t')
            codes[fields[1]] = fields[0]
    sources = {}
    for entry in json.loads(metadata.read_text()):
        code = codes.get(entry['boundaryISO'])
        level = entry['boundaryType']
        if code and level in ('ADM1', 'ADM2'):
            previous = sources.get(code)
            if not previous or level > previous['boundaryType']:
                sources[code] = entry
    return sources


def rounded(value):
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return round(value, 5) if isinstance(value, float) else value


def pack(item):
    code, source = item
    url = source['simplifiedGeometryGeoJSON']
    # GitHub large-file URLs must resolve to their actual content.
    url = url.replace('https://github.com/wmgeolab/geoBoundaries/raw/',
                      'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/')
    path = CACHE / (source['boundaryID'] + '.json')
    if not path.exists():
        download(url, path)
    raw = json.loads(path.read_text())
    features = []
    unnamed = 0
    for feature in raw['features']:
        properties = feature['properties']
        geometry = feature['geometry']
        if not properties.get('shapeName'):
            unnamed += 1
            continue
        if not geometry or geometry['type'] not in ('Polygon', 'MultiPolygon'):
            raise ValueError(f'Unexpected geometry for {code}')
        features.append({
            'id': properties['shapeID'],
            'properties': {'name': properties['shapeName']},
            'geometry': {'type': geometry['type'], 'coordinates': rounded(geometry['coordinates'])},
        })
    if not features:
        raise ValueError(f'Empty boundary file for {code}')
    encoded = json.dumps(features, ensure_ascii=False, separators=(',', ':')).encode()
    packed = gzip.compress(encoded, mtime=0)
    (OUTPUT / (code + '.json.gz')).write_bytes(packed)
    return code, {
        'source': 'geoBoundaries',
        'excludedUnnamedFeatures': unnamed,
        'url': f'https://www.geoboundaries.org/api/current/gbOpen/{source["boundaryISO"]}/{source["boundaryType"]}/',
        'level': source['boundaryType'],
        'year': source['boundaryYearRepresented'],
        'boundaryID': source['boundaryID'],
        'license': source['boundaryLicense'],
        'licenseSource': source.get('licenseSource', ''),
        'licenseDetail': source.get('licenseDetail', ''),
        'sourceURL': source.get('boundarySourceURL', ''),
        'originalSource': source['boundarySource'],
        'downloadURL': url,
        'sha256': hashlib.sha256(packed).hexdigest(),
    }


if __name__ == '__main__':
    sources = read_sources()
    overrides = {
        'NO': {'source': 'Kartverket', 'url': 'https://www.kartverket.no/api-og-data/grensedata', 'level': 'municipality', 'year': '2025', 'license': 'CC BY 4.0'},
        'FR': {'source': 'Etalab / IGN', 'url': 'https://www.data.gouv.fr/datasets/contours-administratifs', 'level': 'municipality', 'year': '2026', 'license': 'Licence Ouverte 2.0'},
        'US': {'source': 'geoBoundaries / U.S. Census Bureau', 'url': 'https://www.geoboundaries.org/api/current/gbOpen/USA/ADM2/', 'level': 'county', 'year': '2018', 'license': 'Public Domain'},
    }
    manifest = dict(overrides)
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        tasks = {pool.submit(pack, item): item[0] for item in sources.items() if item[0] not in overrides}
        for future in concurrent.futures.as_completed(tasks):
            code = tasks[future]
            try:
                _, entry = future.result()
                manifest[code] = entry
            except Exception as error:
                failures.append(code)
                print(f'FAILED {code}: {error}', flush=True)
    if failures:
        raise SystemExit('Retry failed downloads: ' + ', '.join(failures))
    for code in overrides:
        if not (OUTPUT / (code + '.json.gz')).exists():
            raise SystemExit(f'Missing preserved country file: {code}')
    MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + '\n')
    (OUTPUT / 'sources.json').write_text(MANIFEST.read_text())
    print(f'Packed {len(manifest)} countries and territories', flush=True)
