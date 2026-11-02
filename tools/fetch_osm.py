"""Downloads OpenStreetMap data for the Park Pack map area into tools/osm/raw.json."""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

BBOX = "42.3470,-71.0690,42.3720,-71.0440"  # south,west,north,east with margin
Q = f"""[out:json][timeout:120][bbox:{BBOX}];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"];
  way["natural"="coastline"];
  way["natural"="water"]; relation["natural"="water"];
  way["leisure"~"^(park|garden|dog_park|playground|pitch)$"]; relation["leisure"="park"];
  way["landuse"~"^(grass|recreation_ground)$"];
  way["building"];
  way["man_made"="pier"];
);
out geom;"""
URL = sys.argv[1] if len(sys.argv) > 1 else "https://overpass.private.coffee/api/interpreter"
out = Path(__file__).resolve().parent / "osm" / "raw.json"
req = urllib.request.Request(URL,
        data=urllib.parse.urlencode({"data": Q}).encode(),
        headers={"User-Agent": "ParkPack-map-builder/1.0 (personal project)"})
with urllib.request.urlopen(req, timeout=180) as r:
    data = r.read()
out.write_bytes(data)
d = json.loads(data)
print(len(d["elements"]), "elements,", len(data)//1024, "KB")
