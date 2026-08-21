"""Genera docs/report/03b_geo.js a partir de Natural Earth 50m (dominio publico).

Recorta los contornos a la ventana del mapa, simplifica (Douglas-Peucker), tira
islotes irrelevantes y cuantiza a 2 decimales.

Es lo UNICO del proyecto que necesita red, y solo se ejecuta cuando cambia la
ventana del mapa o la lista de paises con negocio: su salida se versiona, de modo
que `build_report.py` sigue construyendo el informe sin conexion.

    python docs/make_geo.py            # descarga el fuente si hace falta
    python docs/make_geo.py ruta.geojson
"""
import json, io, sys, urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

NE_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
          "master/geojson/ne_50m_admin_0_countries.geojson")
DOCS = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else DOCS / "ne50.geojson"
OUT = DOCS / "report" / "03b_geo.js"

if not SRC.exists():
    print(f"descargando {NE_URL} ...")
    urllib.request.urlretrieve(NE_URL, SRC)

# Ventana geografica del mapa: todas las plazas del catalogo con margen.
LON0, LON1, LAT0, LAT1 = -12.5, 17.5, 34.5, 56.0
TOL = 0.04          # grados (~0,8 px al tamano de render)
MIN_AREA = 0.02     # grados^2: conserva Mallorca/Ibiza/Menorca, descarta islotes

# Paises con negocio -> nombre tal y como viene en el dataset.
BUSINESS = {
    "ESP": "España", "FRA": "Francia", "ITA": "Italia", "DEU": "Alemania",
    "PRT": "Portugal", "BEL": "Bélgica", "NLD": "Países Bajos",
}


def clip(poly, inside, inter):
    """Sutherland-Hodgman contra un semiplano."""
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ain, bin_ = inside(a), inside(b)
        if ain:
            out.append(a)
            if not bin_:
                out.append(inter(a, b))
        elif bin_:
            out.append(inter(a, b))
    return out


def clip_rect(poly):
    def ix(a, b, x):
        t = (x - a[0]) / (b[0] - a[0])
        return (x, a[1] + t * (b[1] - a[1]))

    def iy(a, b, y):
        t = (y - a[1]) / (b[1] - a[1])
        return (a[0] + t * (b[0] - a[0]), y)

    poly = clip(poly, lambda p: p[0] >= LON0, lambda a, b: ix(a, b, LON0))
    if not poly: return []
    poly = clip(poly, lambda p: p[0] <= LON1, lambda a, b: ix(a, b, LON1))
    if not poly: return []
    poly = clip(poly, lambda p: p[1] >= LAT0, lambda a, b: iy(a, b, LAT0))
    if not poly: return []
    return clip(poly, lambda p: p[1] <= LAT1, lambda a, b: iy(a, b, LAT1))


def dp(pts, tol):
    """Douglas-Peucker iterativo."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]; bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if den == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, k
        if bi > 0 and best > tol * tol:
            keep[bi] = True
            stack.append((i, bi)); stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]


def area(pts):
    s = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]; x1, y1 = pts[(i + 1) % len(pts)]
        s += x0 * y1 - x1 * y0
    return abs(s) / 2


data = json.loads(SRC.read_text(encoding="utf-8"))
out, npts_total = [], 0
for feat in data["features"]:
    pr = feat["properties"]
    # ISO_A3 vale "-99" en Francia y Noruega (Natural Earth las marca asi por sus
    # territorios dependientes); ADM0_A3 siempre trae el codigo del pais.
    iso = pr.get("ADM0_A3") or pr.get("ISO_A3_EH") or pr.get("ISO_A3") or ""
    geom = feat["geometry"]
    if geom is None:
        continue
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    rings = []
    for poly in polys:
        outer = [(float(x), float(y)) for x, y in poly[0]]      # solo anillo exterior
        if max(p[0] for p in outer) < LON0 or min(p[0] for p in outer) > LON1: continue
        if max(p[1] for p in outer) < LAT0 or min(p[1] for p in outer) > LAT1: continue
        c = clip_rect(outer)
        if len(c) < 4 or area(c) < MIN_AREA:
            continue
        s = dp(c, TOL)
        flat, prev = [], None
        for x, y in s:
            q = (round(x, 2), round(y, 2))
            if q != prev:
                flat.extend(q)
                prev = q
        if len(flat) >= 8:
            rings.append(flat)
            npts_total += len(flat) // 2
    if rings:
        rings.sort(key=len, reverse=True)
        out.append({"iso": iso, "name": BUSINESS.get(iso), "rings": rings})

out.sort(key=lambda d: (d["name"] is None, d["iso"]))
body = ",\n".join(
    '  { iso: "%s", name: %s, rings: [%s] }' % (
        d["iso"],
        ('"%s"' % d["name"]) if d["name"] else "null",
        ",".join("[" + ",".join(repr(round(v, 2)) for v in r) + "]" for r in d["rings"]))
    for d in out)

js = f'''/* ===========================================================================
   Contornos de los paises que entran en el mapa del informe.

   Generado UNA vez desde Natural Earth 50m (dominio publico, sin atribucion
   obligatoria) y versionado aqui: el build no necesita red. Recortado a la
   ventana {LON0}..{LON1} lon / {LAT0}..{LAT1} lat, simplificado con
   Douglas-Peucker (tolerancia {TOL} grados) y cuantizado a 2 decimales, que a
   la escala a la que se dibuja es menos de un pixel.

   `name` solo esta relleno en los paises con negocio, y usa exactamente la
   grafia del dataset para poder cruzarlo con `D.countries`. El resto son
   contexto geografico: se pintan en neutro y no reciben dato.

   No editar a mano: rehacer con el script de extraccion si cambia la ventana.
   =========================================================================== */
const GEO_WINDOW = [{LON0}, {LON1}, {LAT0}, {LAT1}];
const GEO_LAND = [
{body}
];
'''

OUT.write_text(js, encoding="utf-8")
kb = len(js.encode("utf-8")) / 1024
print(f"{OUT}  {kb:.1f} KB  ·  {len(out)} paises  ·  {npts_total:,} puntos")
print("con negocio:", ", ".join(d["iso"] for d in out if d["name"]))
print("contexto   :", ", ".join(d["iso"] for d in out if not d["name"]))
