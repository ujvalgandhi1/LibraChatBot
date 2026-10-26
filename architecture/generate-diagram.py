"""Renders the Libra Asset Search (Chatbot) technical architecture diagram to JPEG.

Icons come from the `diagrams` package resource bundle (official Azure/OSS icon art).
Run: python architecture\\generate-diagram.py
"""

from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JPG = os.path.join(HERE, "libra-asset-search-architecture.jpg")

try:
    import diagrams  # noqa: F401  (only used to locate the bundled icon resources)

    ICONS = os.path.join(os.path.dirname(os.path.dirname(diagrams.__file__)), "resources")
except Exception:  # pragma: no cover
    ICONS = os.path.join(sys.prefix, "Lib", "site-packages", "resources")

if not os.path.isdir(ICONS):
    raise SystemExit(f"Icon resources not found at {ICONS}. Run: pip install diagrams")

DOT = "\u00b7"
ARR = "\u2192"

# --------------------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------------------
WHITE = (255, 255, 255)
NAVY = (18, 42, 74)
AZURE = (0, 120, 212)
SLATE = (94, 110, 133)
GREY_TX = (72, 86, 106)
CANVAS = (247, 250, 253)

BAND_NET = (235, 247, 240)
BAND_NET_ED = (150, 196, 168)
BAND_NET_AC = (0, 108, 66)
BAND_ING = (252, 245, 234)
BAND_ING_ED = (222, 190, 140)
BAND_ING_AC = (166, 106, 18)

COLS = [
    ("CLIENTS", (96, 106, 128), (245, 246, 249)),
    ("AZURE APP SERVICE  \u2014  libra-assetsearch-25f9f8", (0, 120, 212), (240, 247, 253)),
    ("AI PLANE  (public endpoints)", (134, 78, 190), (247, 242, 253)),
    ("DATA PLANE  (private endpoints only)", (0, 137, 90), (237, 249, 243)),
]
COL_W = [520, 1180, 800, 900]

# --------------------------------------------------------------------------------------
# Fonts
# --------------------------------------------------------------------------------------
FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for candidate in (name, "segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(os.path.join(FONT_DIR, candidate), size)
        except OSError:
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
    return ImageFont.load_default()


F_TITLE = font("segoeuib.ttf", 54)
F_SUB = font("segoeui.ttf", 26)
F_BAND = font("segoeuib.ttf", 25)
F_COLHEAD = font("segoeuib.ttf", 24)
F_NODE = font("segoeuisb.ttf", 22)
F_META = font("segoeui.ttf", 18)
F_TINY = font("segoeui.ttf", 17)
F_EDGE = font("segoeuisb.ttf", 18)
F_LEG = font("segoeui.ttf", 19)

# --------------------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------------------
MARGIN, GAP = 50, 104
W = MARGIN * 2 + sum(COL_W) + GAP * (len(COL_W) - 1)
COL_X, _x = [], MARGIN
for w in COL_W:
    COL_X.append(_x)
    _x += w + GAP
COL_CX = [COL_X[i] + COL_W[i] // 2 for i in range(len(COL_W))]

img = Image.new("RGB", (W, 100), CANVAS)
d = ImageDraw.Draw(img)


# --------------------------------------------------------------------------------------
# Primitives
# --------------------------------------------------------------------------------------
def dashed_box(xy, radius, fill, outline, width):
    x0, y0, x1, y1 = xy
    d.rounded_rectangle(xy, radius=radius, fill=fill)
    step, on = 24, 13
    for x in range(int(x0) + radius, int(x1) - radius, step):
        d.line([x, y0, min(x + on, x1 - radius), y0], fill=outline, width=width)
        d.line([x, y1, min(x + on, x1 - radius), y1], fill=outline, width=width)
    for y in range(int(y0) + radius, int(y1) - radius, step):
        d.line([x0, y, x0, min(y + on, y1 - radius)], fill=outline, width=width)
        d.line([x1, y, x1, min(y + on, y1 - radius)], fill=outline, width=width)


def wrap(s: str, f, max_w: int):
    words, lines, cur = s.split(), [], ""
    for w_ in words:
        trial = f"{cur} {w_}".strip()
        if d.textlength(trial, font=f) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


_icon_cache: dict[tuple[str, int], Image.Image] = {}


def icon(rel: str, size: int) -> Image.Image:
    key = (rel, size)
    if key not in _icon_cache:
        im = Image.open(os.path.join(ICONS, rel.replace("/", os.sep))).convert("RGBA")
        scale = size / max(im.size)
        _icon_cache[key] = im.resize(
            (max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS
        )
    return _icon_cache[key]


def paste_icon(rel: str, cx: int, cy: int, size: int):
    im = icon(rel, size)
    img.paste(im, (int(cx - im.width / 2), int(cy - im.height / 2)), im)


def arrow(p0, p1, color=AZURE, width=7, head=26, dashed=False):
    x0, y0 = p0
    x1, y1 = p1
    ang = math.atan2(y1 - y0, x1 - x0)
    bx, by = x1 - head * 0.85 * math.cos(ang), y1 - head * 0.85 * math.sin(ang)
    if dashed:
        total = math.hypot(bx - x0, by - y0)
        seg, gapl, t = 18, 13, 0.0
        while t < total:
            t2 = min(t + seg, total)
            d.line([x0 + (bx - x0) * t / total, y0 + (by - y0) * t / total,
                    x0 + (bx - x0) * t2 / total, y0 + (by - y0) * t2 / total],
                   fill=color, width=width)
            t = t2 + gapl
    else:
        d.line([x0, y0, bx, by], fill=color, width=width)
    d.polygon([
        (x1, y1),
        (x1 - head * math.cos(ang - 0.42), y1 - head * math.sin(ang - 0.42)),
        (x1 - head * math.cos(ang + 0.42), y1 - head * math.sin(ang + 0.42)),
    ], fill=color)


def node(cx, top, w, rel_icon, title, metas=(), accent=AZURE, tint=WHITE, icon_size=70,
         badge=None, draw_it=True):
    pad = 16
    text_x = cx - w // 2 + icon_size + pad * 2
    text_w = (cx + w // 2 - pad) - text_x
    tlines = wrap(title, F_NODE, text_w)
    mlines: list[str] = []
    for m in metas:
        mlines.extend(wrap(m, F_META, text_w))
    text_h = len(tlines) * 27 + (6 if mlines else 0) + len(mlines) * 23
    h = max(icon_size + pad * 2, text_h + pad * 2)
    if not draw_it:
        return top + h

    x0, y0, x1, y1 = cx - w // 2, top, cx + w // 2, top + h
    d.rounded_rectangle([x0 + 3, y0 + 4, x1 + 3, y1 + 4], radius=14, fill=(226, 233, 241))
    d.rounded_rectangle([x0, y0, x1, y1], radius=14, fill=tint, outline=accent, width=2)
    d.rounded_rectangle([x0, y0 + 8, x0 + 7, y1 - 8], radius=3, fill=accent)
    paste_icon(rel_icon, x0 + pad + icon_size // 2 + 4, (y0 + y1) // 2, icon_size)
    ty = y0 + (h - text_h) // 2
    for ln in tlines:
        d.text((text_x, ty), ln, font=F_NODE, fill=NAVY)
        ty += 27
    if mlines:
        ty += 6
    for ln in mlines:
        d.text((text_x, ty), ln, font=F_META, fill=GREY_TX)
        ty += 23
    if badge:
        bw = d.textlength(badge, font=F_TINY)
        d.rounded_rectangle([x1 - bw - 26, y0 - 13, x1 - 6, y0 + 13], radius=13, fill=accent)
        d.text((x1 - bw - 16, y0 - 9), badge, font=F_TINY, fill=WHITE)
    return y1


# --------------------------------------------------------------------------------------
# Content
# --------------------------------------------------------------------------------------
COL_NODES: list[list[dict]] = [
    # ---- Clients --------------------------------------------------------------------
    [
        dict(rel="onprem/client/users.png", title="Business users",
             metas=["Public HTTPS, no sign-in", "Natural-language asset search"]),
        dict(rel="azure/general/browser.png", title="Browser",
             metas=["React 18 SPA (hash routes)", "Renders results + viewers in-page"]),
        dict(rel="onprem/client/user.png", title="Data stewards",
             metas=["Follow results into Purview", "Rate answer quality 1\u20135"]),
    ],
    # ---- App Service ----------------------------------------------------------------
    [
        dict(rel="azure/general/browser.png", title="React SPA  (Vite build, served from /dist)",
             metas=[f"App.jsx \u2014 search box, result cards, RatingBar (1\u20135)",
                    f"PdfViewer (pdf.js canvas) {DOT} TableViewer (CSV/TSV/JSON/Parquet)",
                    f"ImageViewer {DOT} view-only chrome, no native toolbar",
                    "Lazy-loaded chunks per viewer route"]),
        dict(rel="programming/language/nodejs.png", title="Express API  (Node 22, server/index.js)",
             metas=[f"POST /api/search \u2014 embed {ARR} hybrid+semantic {ARR} group",
                    "POST /api/feedback \u2014 1\u20135 rating " + ARR + " Azure SQL",
                    f"GET /api/file \u2014 streams private blobs (Range aware)",
                    f"GET /api/sql|databricks|cosmos|adx-preview \u2014 10-row previews",
                    f"helmet CSP {DOT} compression {DOT} 60 req/min per IP"]),
        dict(rel="azure/identity/managed-identities.png", title="System-assigned managed identity",
             metas=["No keys or connection strings anywhere in the app",
                    f"Search Index Data Reader {DOT} Cognitive Services OpenAI User",
                    f"Storage Blob Data Reader {DOT} db_datareader + INSERT on feedback"]),
    ],
    # ---- AI plane -------------------------------------------------------------------
    [
        dict(rel="azure/aimachinelearning/cognitive-services.png", title="Azure OpenAI  \u2014  hokieopenai",
             metas=["text-embedding-3-large (3072 dims)",
                    "Embeds the user's query at request time",
                    "Entra token via managed identity"], badge="public"),
        dict(rel="azure/aimachinelearning/cognitive-search.png", title="Azure AI Search  \u2014  libraaisearch",
             metas=["Index: main-assets-index",
                    f"BM25 keyword + HNSW vector (cosine)",
                    "Semantic reranker config 'semcfg'",
                    "Reranker score \u2265 1.8 filter drops backfill"], badge="public"),
        dict(rel="azure/general/search-grid.png", title="Result post-processing",
             metas=["Groups duplicate assets by name",
                    "Collapses multiple storage locations",
                    "Stamps a searchId GUID on the response"]),
    ],
    # ---- Data plane -----------------------------------------------------------------
    [
        dict(rel="azure/database/sql-databases.png", title="Azure SQL  \u2014  hokiecopilotchatsqlserver",
             metas=["dbo.search_feedback \u2014 rating, query_text,",
                    f"result_count, search_id, created_utc",
                    "App identity has INSERT on this table only",
                    "Also serves /api/sql-preview (db_datareader)"], badge="PE 10.0.3.8"),
        dict(rel="azure/storage/data-lake-storage.png", title="ADLS Gen2 storage",
             metas=[f"hokiedemoadls2 {DOT} hokiepurviewadls01",
                    f"PDFs {DOT} CSV {DOT} Parquet {DOT} JSON {DOT} images",
                    "Public network access disabled"], badge="Private Endpoint"),
        dict(rel="azure/analytics/azure-databricks.png", title="Azure Databricks",
             metas=["SQL warehouse, Unity Catalog + Hive",
                    "Statement Execution API preview"], badge="optional"),
        dict(rel="azure/databases/azure-cosmos-db.png", title="Azure Cosmos DB",
             metas=["SQL API container preview", "Data-plane reader role"], badge="optional"),
        dict(rel="azure/analytics/azure-data-explorer-clusters.png", title="Azure Data Explorer",
             metas=["KQL table preview (Viewer role)", "Cluster must be running"], badge="optional"),
    ],
]

NODE_SPACING = 16

# --------------------------------------------------------------------------------------
# Measure pass
# --------------------------------------------------------------------------------------
HDR_H = 148
C_Y0 = HDR_H + 58
C_HEAD = 54
c_body_top = C_Y0 + C_HEAD + 26


def column_height(idx: int) -> int:
    y = c_body_top
    for n in COL_NODES[idx]:
        y = node(COL_CX[idx], y, COL_W[idx] - 40, n["rel"], n["title"], n["metas"], draw_it=False) + NODE_SPACING
    return y - NODE_SPACING


C_Y1 = max(column_height(i) for i in range(len(COL_NODES))) + 26

N_Y0 = C_Y1 + 76
N_Y1 = N_Y0 + 178
I_Y0 = N_Y1 + 74
I_Y1 = I_Y0 + 196
H = I_Y1 + 124

img = Image.new("RGB", (W, H), CANVAS)
d = ImageDraw.Draw(img)

# --------------------------------------------------------------------------------------
# Header
# --------------------------------------------------------------------------------------
d.rectangle([0, 0, W, HDR_H - 8], fill=NAVY)
d.rectangle([0, HDR_H - 8, W, HDR_H], fill=AZURE)
d.text((56, 30), "Libra Asset Search  \u2014  Technical Architecture", font=F_TITLE, fill=WHITE)
d.text((60, 96),
       f"Semantic search over the Microsoft Purview catalog   \u2022   Azure App Service (P0V3 Linux, Node 22)"
       f"   \u2022   Keyless: system-assigned managed identity throughout   \u2022   East US 2",
       font=F_SUB, fill=(176, 205, 236))

# --------------------------------------------------------------------------------------
# Columns
# --------------------------------------------------------------------------------------
for i, (label, accent, tint) in enumerate(COLS):
    x0, x1 = COL_X[i], COL_X[i] + COL_W[i]
    d.rounded_rectangle([x0, C_Y0, x1, C_Y1], radius=20, fill=tint, outline=accent, width=3)
    d.rounded_rectangle([x0, C_Y0, x1, C_Y0 + C_HEAD], radius=20, fill=accent)
    d.rectangle([x0, C_Y0 + 34, x1, C_Y0 + C_HEAD], fill=accent)
    d.text((COL_CX[i], C_Y0 + 13), label, font=F_COLHEAD, fill=WHITE, anchor="ma")

    y = c_body_top
    for n in COL_NODES[i]:
        y = node(COL_CX[i], y, COL_W[i] - 40, n["rel"], n["title"], n["metas"],
                 accent=accent, badge=n.get("badge")) + NODE_SPACING

# ---- Request-flow arrows between columns ---------------------------------------------
FLOW = [
    ("HTTPS 443", COLS[1][1], False),
    ("embed +\nsearch", COLS[2][1], False),
    ("rating\ninsert", COLS[3][1], False),
]
gap_y = C_Y0 + C_HEAD + 132
for i, (label, accent, dashed) in enumerate(FLOW):
    gx0 = COL_X[i] + COL_W[i] + 14
    gx1 = COL_X[i + 1] - 14
    gcx = (gx0 + gx1) // 2
    lines = label.split("\n")
    lw = max(d.textlength(s, font=F_EDGE) for s in lines)
    lh = len(lines) * 23 + 14
    d.rounded_rectangle([gcx - lw / 2 - 12, gap_y - lh - 20, gcx + lw / 2 + 12, gap_y - 20],
                        radius=10, fill=WHITE, outline=accent, width=2)
    ty = gap_y - lh - 13
    for s in lines:
        d.text((gcx, ty), s, font=F_EDGE, fill=accent, anchor="ma")
        ty += 23
    arrow((gx0, gap_y + 8), (gx1, gap_y + 8), color=accent, width=8, head=26, dashed=dashed)

# --------------------------------------------------------------------------------------
# Network band
# --------------------------------------------------------------------------------------
dashed_box([50, N_Y0, W - 50, N_Y1], 20, BAND_NET, BAND_NET_ED, 3)
d.rounded_rectangle([78, N_Y0 - 20, 1155, N_Y0 + 22], radius=10, fill=BAND_NET_AC)
d.text((100, N_Y0 - 15),
       f"NETWORK PATH  \u2014  how the app reaches private-only data  {DOT}  no public data endpoints",
       font=F_BAND, fill=WHITE)

net = [
    ("azure/networking/virtual-networks.png", "Regional VNet integration",
     [f"Delegated subnet snet-appservice", "10.0.6.0/27 in hokiesynapsevirtualnetwork01"]),
    ("azure/network/dns-private-zones.png", "Private DNS zones",
     [f"privatelink.blob {DOT} dfs {DOT} database", "WEBSITE_DNS_SERVER=168.63.129.16"]),
    ("azure/networking/private-link.png", "Private endpoints",
     [f"Storage blob {DOT} Azure SQL 10.0.3.8", "Traffic never leaves the VNet"]),
    ("azure/general/gear.png", "WEBSITE_VNET_ROUTE_ALL=1",
     ["All outbound routed through the VNet", "AI Search + OpenAI stay public"]),
]
nw, ngap = 830, 30
nx = (W - (len(net) * nw + (len(net) - 1) * ngap)) // 2 + nw // 2
for rel, t, m in net:
    node(nx, N_Y0 + 40, nw, rel, t, m, accent=BAND_NET_AC, icon_size=62)
    nx += nw + ngap

# --------------------------------------------------------------------------------------
# Offline index pipeline band
# --------------------------------------------------------------------------------------
dashed_box([50, I_Y0, W - 50, I_Y1], 20, BAND_ING, BAND_ING_ED, 3)
d.rounded_rectangle([78, I_Y0 - 20, 1210, I_Y0 + 22], radius=10, fill=BAND_ING_AC)
d.text((100, I_Y0 - 15),
       f"OFFLINE INDEX PIPELINE  \u2014  run from Chatbot/scripts, not at request time",
       font=F_BAND, fill=WHITE)

pipe = [
    ("azure/databases/azure-purview-accounts.png", "Microsoft Purview",
     ["Source of every catalogued asset", "AI-generated userDescription"]),
    ("azure/general/file.png", "main_assets.csv",
     [f"assetId {DOT} name {DOT} entityType {DOT} purviewUrl", "qualifiedName + userDescription"]),
    ("azure/aimachinelearning/cognitive-services.png", "ingest.ps1",
     ["Embeds userDescription in batches", "text-embedding-3-large \u2192 3072 dims"]),
    ("azure/aimachinelearning/cognitive-search.png", "main-assets-index",
     [f"create-index.ps1 defines the schema", "HNSW vector profile + semcfg reranker"]),
]
pw, pgap = 830, 30
px = (W - (len(pipe) * pw + (len(pipe) - 1) * pgap)) // 2 + pw // 2
centers = []
for rel, t, m in pipe:
    node(px, I_Y0 + 40, pw, rel, t, m, accent=BAND_ING_AC, icon_size=62)
    centers.append(px)
    px += pw + pgap
for i in range(len(centers) - 1):
    arrow((centers[i] + pw // 2 + 4, I_Y0 + 96), (centers[i + 1] - pw // 2 - 4, I_Y0 + 96),
          color=BAND_ING_AC, width=6, head=20)

# --------------------------------------------------------------------------------------
# Footer legend
# --------------------------------------------------------------------------------------
F_Y = I_Y1 + 20
d.rectangle([0, F_Y, W, H], fill=(238, 243, 249))
lx = 56
for swatch, txt in [
    (COLS[1][1], "Compute (App Service)"),
    (COLS[2][1], "AI service, public endpoint"),
    (COLS[3][1], "Data service, private endpoint"),
    (BAND_NET_AC, "Networking"),
    (BAND_ING_AC, "Offline pipeline"),
]:
    d.rounded_rectangle([lx, F_Y + 34, lx + 26, F_Y + 60], radius=6, fill=swatch)
    d.text((lx + 38, F_Y + 34), txt, font=F_LEG, fill=GREY_TX)
    lx += int(d.textlength(txt, font=F_LEG)) + 92

d.text((W - 56, F_Y + 34),
       f"The site itself is public and unauthenticated {DOT} it reads private data with its own identity "
       f"{DOT} stop the app between demos",
       font=F_LEG, fill=(176, 62, 40), anchor="ra")

img.save(OUT_JPG, "JPEG", quality=94, subsampling=0, optimize=True, dpi=(200, 200))
print(f"Wrote {OUT_JPG}  ({img.width}x{img.height})")
