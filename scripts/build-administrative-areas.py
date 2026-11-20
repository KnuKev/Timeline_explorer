"""Pack public boundary downloads as compact files for the local analysis worker."""
import argparse
import gzip
import json
import xml.etree.ElementTree as ET
from pathlib import Path

GML = '{http://www.opengis.net/gml/3.2}'
APP = '{https://skjema.geonorge.no/SOSI/produktspesifikasjon/AdmEnheter/20240101}'


def norwegian_municipalities(path):
    for municipality in ET.parse(path).iter(APP + 'Kommune'):
        polygons = []
        for polygon in municipality.iter(GML + 'Polygon'):
            rings = []
            for ring in polygon:
                values = next(ring.iter(GML + 'posList')).text.split()
                rings.append([[round(float(lon), 5), round(float(lat), 5)]
                              for lon, lat in zip(values[::2], values[1::2])])
            polygons.append(rings)
        yield {
            'id': municipality.findtext(APP + 'kommunenummer'),
            'properties': {'name': municipality.findtext(APP + 'kommunenavn')},
            'geometry': {'type': 'MultiPolygon', 'coordinates': polygons},
        }


def geojson_features(file, id_key, name_key):
    for feature in json.load(file)['features']:
        properties = feature['properties']
        yield {
            'id': properties[id_key],
            'properties': {'name': properties[name_key]},
            'geometry': feature['geometry'],
        }


def pack(code, features):
    path = Path('public/areas') / (code + '.json.gz')
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(list(features), ensure_ascii=False, separators=(',', ':')).encode()
    path.write_bytes(gzip.compress(encoded, mtime=0))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('norway', help='Kartverket Kommune GML, EPSG:4326')
    parser.add_argument('france', help='Etalab communes-100m.geojson.gz')
    parser.add_argument('usa', help='geoBoundaries USA ADM2 simplified GeoJSON')
    args = parser.parse_args()
    pack('NO', norwegian_municipalities(args.norway))
    with gzip.open(args.france, 'rt', encoding='utf-8') as file:
        pack('FR', geojson_features(file, 'code', 'nom'))
    with open(args.usa, encoding='utf-8') as file:
        pack('US', geojson_features(file, 'shapeID', 'shapeName'))
