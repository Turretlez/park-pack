"""Turns tools/osm/raw.json (OpenStreetMap) into the inline SVG map in index.html.

Writes everything between <!-- MAP START --> and <!-- MAP END --> and prints
each park's projected x,y for the PARKS table.
"""
import json, re
from pathlib import Path
from shapely.geometry import LineString, Polygon, box, Point
from shapely.ops import unary_union, polygonize

ROOT = Path(__file__).resolve().parent.parent
W, E, S, N = -71.0650, -71.0470, 42.3500, 42.3700
VW = 400
KX = 0.73925  # cos(42.36°)
VH = round(VW * (N - S) / ((E - W) * KX))

def xy(lat, lon):
    return ((lon - W) / (E - W) * VW, (N - lat) / (N - S) * VH)

FRAME = box(-2, -2, VW + 2, VH + 2)
data = json.load(open(ROOT / "tools/osm/raw.json", encoding="utf-8"))

def ring(geom):
    return [xy(p["lat"], p["lon"]) for p in geom if p]

def d_line(g):
    out = []
    for ls in getattr(g, "geoms", [g]):
        if ls.is_empty or ls.geom_type != "LineString": continue
        c = list(ls.coords)
        out.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in c))
    return "".join(out)

def d_poly(g):
    out = []
    for p in getattr(g, "geoms", [g]):
        if p.is_empty or p.geom_type != "Polygon": continue
        for r in [p.exterior, *p.interiors]:
            c = list(r.coords)[:-1]
            if len(c) >= 3: out.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in c) + "Z")
    return "".join(out)

coast, roads, labels_src = [], {"major": [], "minor": [], "ped": []}, {}
bld, green, piers, water = [], [], [], []
road_pts = []
for e in data["elements"]:
    t = e.get("tags", {})
    if e["type"] == "relation":
        geoms = [m.get("geometry") for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
    else:
        geoms = [e.get("geometry")] if e.get("geometry") else []
    for g in geoms:
        pts = ring(g)
        if len(pts) < 2: continue
        hw = t.get("highway")
        if t.get("natural") == "coastline":
            coast.append(LineString(pts)); continue
        if hw:
            if t.get("tunnel") in ("yes", "building_passage") or t.get("layer", "0").startswith("-"): continue
            cls = ("major" if hw.split("_")[0] in ("motorway", "trunk", "primary", "secondary")
                   else "ped" if hw in ("pedestrian", "footway", "path", "steps") else "minor")
            ls = LineString(pts).intersection(FRAME)
            if ls.is_empty: continue
            roads[cls].append(ls.simplify(0.25))
            road_pts += pts[::3]
            nm = t.get("name")
            if nm and cls != "ped": labels_src.setdefault(nm, []).append(LineString(pts))
            continue
        if len(pts) < 3: continue
        try:
            poly = Polygon(pts).buffer(0)
        except Exception:
            continue
        poly = poly.intersection(FRAME)
        if poly.is_empty: continue
        if "building" in t:
            if poly.area >= 1.5: bld.append(poly.simplify(0.35))
        elif t.get("leisure") in ("park", "garden", "dog_park", "playground", "pitch") or t.get("landuse") in ("grass", "recreation_ground") or t.get("natural") == "grass":
            green.append(poly.simplify(0.3))
        elif t.get("man_made") == "pier":
            piers.append(poly.simplify(0.3))
        elif t.get("natural") == "water":
            water.append(poly.simplify(0.3))

# Land vs water from the coastline. OSM draws coastline with land on the left;
# the SVG y-axis is flipped, so here land is on the right of each segment.
pieces = list(polygonize(unary_union([*[c.intersection(FRAME.buffer(1)) for c in coast], FRAME.boundary])))
land_pts, water_pts = [], []
for c in coast:
    cs = list(c.coords)
    for (x1, y1), (x2, y2) in zip(cs, cs[1:]):
        dx, dy = x2 - x1, y2 - y1
        ln = (dx * dx + dy * dy) ** 0.5
        if ln < 0.5: continue
        mx, my, nx, ny = (x1 + x2) / 2, (y1 + y2) / 2, -dy / ln, dx / ln
        land_pts.append(Point(mx - nx * 0.6, my - ny * 0.6))
        water_pts.append(Point(mx + nx * 0.6, my + ny * 0.6))
land = []
for pc in pieces:
    pc = pc.intersection(FRAME)
    if pc.area < 1: continue
    nl = sum(1 for q in land_pts if pc.contains(q)); nw = sum(1 for q in water_pts if pc.contains(q))
    if nl >= nw: land.append(pc)
    print("piece", round(pc.area), "land votes", nl, "water votes", nw)
land = unary_union(land + piers).simplify(0.3)

# Street labels on the longest stretch of a few streets the pack walks.
LABEL = ["Atlantic Ave", "Commercial Street", "Hanover Street", "State Street", "Congress Street",
         "Summer Street", "Cross Street", "Tremont Street", "Washington Street", "Milk Street",
         "Cambridge Street", "Purchase Street", "Seaport Boulevard", "Salem Street"]
label_svg, defs = [], []
for i, name in enumerate(LABEL):
    keys = [k for k in labels_src if k.lower().replace("avenue", "ave").replace("street", "st") ==
            name.lower().replace("avenue", "ave").replace("street", "st")]
    if not keys: continue
    merged = unary_union([l for k in keys for l in labels_src[k]]).intersection(FRAME.buffer(-12))
    segs = [g for g in getattr(merged, "geoms", [merged]) if g.geom_type == "LineString"]
    if not segs: continue
    seg = max(segs, key=lambda g: g.length)
    if seg.length < 60: continue
    c = list(seg.simplify(1.5).coords)
    if c[0][0] > c[-1][0]: c.reverse()
    pid = f"st{i}"
    defs.append(f'<path id="{pid}" d="M' + "L".join(f"{x:.1f},{y:.1f}" for x, y in c) + '"/>')
    short = name.replace(" Street", " St").replace(" Boulevard", " Blvd")
    label_svg.append(f'<text class="stl"><textPath href="#{pid}" startOffset="50%" text-anchor="middle">{short}</textPath></text>')

svg = [
    f'<svg id="map" viewBox="0 0 {VW} {VH}" role="img" aria-label="Map of downtown Boston, the Greenway and the North End">',
    "<defs>" + "".join(defs) + "</defs>",
    f'<rect class="water" width="{VW}" height="{VH}"/>',
    f'<path class="land" d="{d_poly(land)}"/>',
    f'<path class="water" d="{d_poly(unary_union(water))}"/>' if water else "",
    f'<path class="grass" d="{d_poly(unary_union(green))}"/>',
    f'<path class="bldg" d="{d_poly(unary_union(bld))}"/>',
    f'<path class="road ped" d="{d_line(unary_union(roads["ped"]))}"/>',
    f'<path class="road minor" d="{d_line(unary_union(roads["minor"]))}"/>',
    f'<path class="road major-case" d="{d_line(unary_union(roads["major"]))}"/>',
    f'<path class="road major" d="{d_line(unary_union(roads["major"]))}"/>',
    '<g class="labels">' + "".join(label_svg) + "</g>",
    '<g id="hoods"></g>',
    '<g id="pins"></g>',
    "</svg>",
]
html = (ROOT / "index.html").read_text(encoding="utf-8")
new = re.sub(r"<!-- MAP START -->.*?<!-- MAP END -->", lambda m: "<!-- MAP START -->\n" + "\n".join(s for s in svg if s) + "\n<!-- MAP END -->", html, flags=re.S)
(ROOT / "index.html").write_text(new, encoding="utf-8")
print("viewBox", VW, VH, "| map bytes", len("\n".join(svg)), "| labels", len(label_svg))

PARKS = {
    "rowes": (42.35622, -71.05123), "longwharf": (42.35842, -71.0518), "columbus": (42.3613, -71.05188),
    "ruff": (42.36679, -71.05679), "langone": (42.36855, -71.05498), "prado": (42.36577, -71.05361),
    "northmeadow": (42.36486, -71.05865), "cityhall": (42.3603, -71.0580), "pos": (42.35628, -71.05579),
    "dewey": (42.35374, -71.05422), "fortpoint": (42.35193, -71.04987), "common": (42.3556, -71.0638),
}
for k, (la, lo) in PARKS.items():
    x, y = xy(la, lo); print(f"{k}: x:{x:.0f}, y:{y:.0f}")
HOODS = {"NORTH END": (42.3652, -71.0548), "WATERFRONT": (42.3600, -71.0503), "FINANCIAL DISTRICT": (42.3545, -71.0570),
         "DOWNTOWN": (42.3560, -71.0605), "BEACON HILL": (42.3590, -71.0640), "FORT POINT": (42.3510, -71.0485), "HARBOR": (42.3640, -71.0485)}
for k, (la, lo) in HOODS.items():
    x, y = xy(la, lo); print(f"hood {k}: {x:.0f},{y:.0f}")
