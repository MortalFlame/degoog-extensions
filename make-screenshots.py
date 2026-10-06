#!/usr/bin/env python3
"""Generate Store card images for degoog-extensions.

These are BRAND CARDS, not screenshots. A real screenshot has to be captured from
a running DeGoog instance; this script draws an honest, good-looking card per
extension instead, optionally compositing the vendor's official logo when one is
available. It never fabricates paper titles, DOIs, authors or citation counts.

No third-party imaging libraries are available in this workspace, so PNGs are
decoded and encoded by hand: IHDR/IDAT/IEND, zlib, and a 5x7 bitmap font for text.

No third-party images are bundled or used by default: every card is generated from scratch, so
there is no licence to honour. If you ever obtain a logo you are entitled to use, drop it in the
folder given by --brand-dir named after the item key (firecrawl.png, openalex.png, ...) and it will
be composited onto the card; any missing logo falls back to abstract geometry.

Usage:
    python3 make-screenshots.py [--brand-dir DIR] [--out-name NAME]
"""

import argparse
import os
import struct
import sys
import zlib

W, H = 1200, 750

BG = (0x0B, 0x0D, 0x12)
PANEL = (0x14, 0x16, 0x1E)
INSET = (0x1A, 0x1D, 0x27)
BORDER = (0x2A, 0x2E, 0x3C)
ACCENT = (0x7C, 0x5C, 0xFF)
ACCENT2 = (0x7D, 0xC4, 0xFF)
TEXT = (0xE8, 0xEA, 0xF0)
MUTED = (0x9A, 0xA0, 0xAC)
LIGHT_TILE = (0xF2, 0xF3, 0xF7)
DARK_TILE = (0x0B, 0x0D, 0x12)

FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
    "F": ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "11111", "10001", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "11100", "10100", "10010", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    " ": ["00000"] * 7,
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
    ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
    "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
    "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
    ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
    "'": ["00100", "00100", "00000", "00000", "00000", "00000", "00000"],
    "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
    "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
}
BLANK = ["00000"] * 7


# --------------------------------------------------------------------------
# PNG decode
# --------------------------------------------------------------------------

def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def png_decode(data):
    """Decode an 8-bit, non-interlaced PNG into (w, h, bytearray RGBA)."""
    if data[:8] != b"\x89PNG\r\n\x1a\x0a":
        raise ValueError("not a PNG")
    i, idat = 8, bytearray()
    w = h = depth = ctype = interlace = None
    palette = b""
    trns = b""
    while i < len(data):
        ln = struct.unpack(">I", data[i:i + 4])[0]
        tag = data[i + 4:i + 8]
        chunk = data[i + 8:i + 8 + ln]
        if tag == b"IHDR":
            w, h, depth, ctype, _c, _f, interlace = struct.unpack(">IIBBBBB", chunk)
        elif tag == b"PLTE":
            palette = chunk
        elif tag == b"tRNS":
            trns = chunk
        elif tag == b"IDAT":
            idat += chunk
        elif tag == b"IEND":
            break
        i += 12 + ln

    if depth != 8:
        raise ValueError(f"unsupported bit depth {depth}")
    if interlace != 0:
        raise ValueError("interlaced PNG not supported")

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = channels
    stride = w * bpp
    raw = zlib.decompress(bytes(idat))

    prev = bytearray(stride)
    out = bytearray()
    pos = 0
    for _y in range(h):
        ft = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ft == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 0xFF
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif ft == 3:
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((left + prev[x]) >> 1)) & 0xFF
        elif ft == 4:
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                upleft = prev[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + _paeth(left, prev[x], upleft)) & 0xFF
        out += line
        prev = line

    rgba = bytearray(w * h * 4)
    for p in range(w * h):
        s = p * bpp
        d = p * 4
        if ctype == 6:
            rgba[d:d + 4] = out[s:s + 4]
        elif ctype == 2:
            rgba[d:d + 3] = out[s:s + 3]
            rgba[d + 3] = 255
        elif ctype == 0:
            g = out[s]
            rgba[d] = rgba[d + 1] = rgba[d + 2] = g
            rgba[d + 3] = 255
        elif ctype == 4:
            g = out[s]
            rgba[d] = rgba[d + 1] = rgba[d + 2] = g
            rgba[d + 3] = out[s + 1]
        elif ctype == 3:
            idx = out[s]
            rgba[d:d + 3] = palette[idx * 3:idx * 3 + 3]
            rgba[d + 3] = trns[idx] if idx < len(trns) else 255
    return w, h, rgba


# --------------------------------------------------------------------------
# Canvas
# --------------------------------------------------------------------------

class Canvas:
    def __init__(self, w, h, bg):
        self.w, self.h = w, h
        self.px = bytearray(bytes(bg) * (w * h))

    def rect(self, x0, y0, x1, y1, color):
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(self.w, x1), min(self.h, y1)
        if x1 <= x0 or y1 <= y0:
            return
        row = bytes(color) * (x1 - x0)
        for y in range(y0, y1):
            o = (y * self.w + x0) * 3
            self.px[o:o + len(row)] = row

    def frame(self, x0, y0, x1, y1, color, t=2):
        self.rect(x0, y0, x1, y0 + t, color)
        self.rect(x0, y1 - t, x1, y1, color)
        self.rect(x0, y0, x0 + t, y1, color)
        self.rect(x1 - t, y0, x1, y1, color)

    def round_rect(self, x0, y0, x1, y1, r, color):
        for y in range(max(0, y0), min(self.h, y1)):
            dy = 0
            if y < y0 + r:
                dy = (y0 + r) - y
            elif y >= y1 - r:
                dy = y - (y1 - r - 1)
            inset = 0
            if dy:
                inner = r * r - dy * dy
                inset = r - int(inner ** 0.5) if inner > 0 else r
            self.rect(x0 + inset, y, x1 - inset, y + 1, color)

    def blit(self, w, h, rgba, x, y, scale=1):
        for sy in range(h):
            ty = y + sy * scale
            if ty < 0 or ty >= self.h:
                continue
            for sx in range(w):
                tx = x + sx * scale
                if tx < 0 or tx >= self.w:
                    continue
                o = (sy * w + sx) * 4
                a = rgba[o + 3]
                if a == 0:
                    continue
                if a == 255:
                    self.rect(tx, ty, tx + scale, ty + scale, rgba[o:o + 3])
                else:
                    for yy in range(ty, min(self.h, ty + scale)):
                        for xx in range(tx, min(self.w, tx + scale)):
                            d = (yy * self.w + xx) * 3
                            for k in range(3):
                                self.px[d + k] = (
                                    rgba[o + k] * a + self.px[d + k] * (255 - a)
                                ) // 255

    def text(self, x, y, s, color, scale=4, spacing=1):
        cx = x
        for ch in s.upper():
            for ry, row in enumerate(FONT.get(ch, BLANK)):
                for rx, bit in enumerate(row):
                    if bit == "1":
                        self.rect(cx + rx * scale, y + ry * scale,
                                  cx + (rx + 1) * scale, y + (ry + 1) * scale, color)
            cx += (5 + spacing) * scale
        return cx

    @staticmethod
    def text_w(s, scale=4, spacing=1):
        return len(s) * (5 + spacing) * scale

    def png(self, path):
        raw = bytearray()
        stride = self.w * 3
        for y in range(self.h):
            raw.append(0)
            raw += self.px[y * stride:(y + 1) * stride]

        def chunk(tag, payload):
            return (struct.pack(">I", len(payload)) + tag + payload
                    + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

        out = b"\x89PNG\r\n\x1a\n"
        out += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 2, 0, 0, 0))
        out += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        out += chunk(b"IEND", b"")
        with open(path, "wb") as fh:
            fh.write(out)


def gradient(c, x0, y0, x1, h):
    for i in range(h):
        t = i / max(1, h - 1)
        c.rect(x0, y0 + i, x1, y0 + i + 1,
               (int(ACCENT[0] + (ACCENT2[0] - ACCENT[0]) * t),
                int(ACCENT[1] + (ACCENT2[1] - ACCENT[1]) * t),
                int(ACCENT[2] + (ACCENT2[2] - ACCENT[2]) * t)))


def resize_rgba(w, h, rgba, nw, nh):
    """Nearest-neighbour resize. Logos are much larger than their card, and
    floor-dividing the scale collapses to 0 and silently renders 1:1."""
    nw, nh = max(1, nw), max(1, nh)
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        sy = min(h - 1, y * h // nh)
        rowbase = sy * w * 4
        obase = y * nw * 4
        for x in range(nw):
            sx = min(w - 1, x * w // nw)
            s_off = rowbase + sx * 4
            o_off = obase + x * 4
            out[o_off:o_off + 4] = rgba[s_off:s_off + 4]
    return nw, nh, out


def average_luma(w, h, rgba):
    total = n = 0
    step = max(1, (w * h) // 20000)
    for p in range(0, w * h, step):
        o = p * 4
        if rgba[o + 3] < 32:
            continue
        total += 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]
        n += 1
    return (total / n / 255.0) if n else None


def transport_art(c, x0, y0, x1, y1, seed):
    """Suggests a page being fetched and rendered. No legible text."""
    bw, bh = x1 - x0, y1 - y0
    bar = 34
    c.round_rect(x0, y0, x1, y0 + bar, 10, (0x1F, 0x23, 0x30))
    c.rect(x0, y0 + bar - 2, x1, y0 + bar, BORDER)
    for i, d in enumerate((13, 13, 13)):
        cx = x0 + 22 + i * 26
        c.rect(cx, y0 + 12, cx + 11, y0 + 23, (0x39, 0x3E, 0x50))
    c.rect(x0 + 112, y0 + 10, x1 - 26, y0 + 25, (0x24, 0x28, 0x36))
    c.rect(x0 + 122, y0 + 15, x0 + 122 + int((bw - 220) * 0.45), y0 + 20, (0x33, 0x38, 0x48))

    # page body: text-line placeholders
    top = y0 + bar + 30
    rows = 4
    rh = (y1 - top - 26 - (rows - 1) * 18) // rows
    for r in range(rows):
        ry = top + r * (rh + 18)
        c.round_rect(x0 + 26, ry, x0 + 26 + rh - 10, ry + rh - 10, 8, INSET)
        tw = int((bw - 120) * (0.88 - 0.11 * ((r + seed) % 3)))
        c.rect(x0 + 26 + rh + 4, ry + 14, x0 + 26 + rh + 4 + tw, ry + 26, (0x2C, 0x31, 0x40))
        c.rect(x0 + 26 + rh + 4, ry + 38, x0 + 26 + rh + 4 + int(tw * 0.58), ry + 47,
               (0x24, 0x28, 0x36))

    # request leaving the page and returning rendered HTML
    lane = y1 - 22
    c.rect(x0 + 26, lane - 3, x1 - 26, lane, (0x2A, 0x2F, 0x3D))
    step = (bw - 120) // 6
    for i in range(6):
        cx = x0 + 40 + i * step
        hot = i == seed % 6
        c.rect(cx, lane - 12 if hot else lane - 8, cx + 14, lane + 4,
               ACCENT if hot else (0x39, 0x3E, 0x50))


def abstract_art(c, x0, y0, x1, y1, seed):
    """Neutral geometry suggesting a result list. No legible text, ever."""
    rows = 5
    pad = 26
    rh = (y1 - y0 - pad * (rows - 1)) // rows
    for r in range(rows):
        ry = y0 + r * (rh + pad)
        c.round_rect(x0, ry, x0 + rh - 8, ry + rh - 8, 10, INSET)
        tw = int((x1 - x0) * (0.86 - 0.09 * ((r + seed) % 3)))
        c.rect(x0 + rh + 16, ry + 12, x0 + rh + 16 + tw, ry + 12 + 14, BORDER)
        c.rect(x0 + rh + 16, ry + 36, x0 + rh + 16 + int(tw * 0.62), ry + 36 + 10, (0x24, 0x28, 0x36))
        c.rect(x0 + rh + 16, ry + 56, x0 + rh + 16 + int(tw * 0.40), ry + 56 + 10, (0x24, 0x28, 0x36))
        if r == seed % rows:
            c.rect(x0 + rh + 16, ry + 12, x0 + rh + 16 + 54, ry + 12 + 14, ACCENT)


ITEMS = [
    ("engines/firecrawl", "Firecrawl", "ENGINE",
     "Web results from the Firecrawl search API.", "firecrawl"),
    ("engines/firecrawl-research", "Firecrawl Research", "ENGINE",
     "Deep-research results, shown as a papers tab.", None),
    ("engines/lobstr", "Lobstr", "ENGINE",
     "Academic literature search via Lobstr.", None),
    ("engines/openalex", "OpenAlex", "ENGINE",
     "Scholarly works with DOI, year and citation count.", "openalex"),
    ("engines/semanticscholar", "Semantic Scholar", "ENGINE",
     "Paper search with citation counts and PDFs.", "semanticscholar"),
    ("engines/serpingapi", "SerpApi", "ENGINE",
     "Google results via the SerpApi endpoint.", "serpingapi"),
    ("engines/serpstack", "SerpStack", "ENGINE",
     "Google results via the SerpStack API.", None),
    ("engines/tavily", "Tavily", "ENGINE",
     "Web search with an adjustable search depth.", None),
    ("transports/browserless-ql-transport", "Browserless QL", "TRANSPORT",
     "Renders pages through a self-hosted Browserless endpoint.", "browserless"),
    ("transports/cloakbrowser-vercel", "CloakBrowser Vercel", "TRANSPORT",
     "Fetches rendered HTML via a serverless browser worker.", None),
    ("transports/scrapedo", "Scrape.do", "TRANSPORT",
     "Proxies requests through Scrape.do with browser modes.", None),
]


def build_card(path, name, kind, tagline, logo, seed):
    c = Canvas(W, H, BG)

    for y in range(H):
        t = y / H
        s = int(7 * max(0.0, 1 - abs(t - 0.22) * 2.4))
        if s > 0:
            c.rect(0, y, 300, y + 1, (0x0B + s, 0x0D + s, 0x12 + s + 7))
    for y in range(H):
        t = y / H
        s = int(6 * max(0.0, 1 - abs(t - 0.82) * 2.6))
        if s > 0:
            c.rect(W - 300, y, W, y + 1, (0x0B + s, 0x0D + s + 1, 0x12 + s + 10))

    PX0, PY0, PX1, PY1 = 80, 132, W - 80, H - 108
    c.round_rect(PX0, PY0, PX1, PY1, 18, PANEL)
    c.frame(PX0, PY0, PX1, PY1, BORDER, 2)
    gradient(c, PX0 + 2, PY0 + 2, PX1 - 2, 7)

    c.rect(120, PY0 + 46, 120 + 140, PY0 + 86, (0x24, 0x1F, 0x45))
    c.frame(120, PY0 + 46, 120 + 140, PY0 + 86, ACCENT, 2)
    c.text(136, PY0 + 59, kind, ACCENT2, scale=3)

    c.text(120, PY0 + 118, name, TEXT, scale=8)

    y = PY0 + 186
    line = ""
    for word in tagline.split():
        trial = (line + " " + word).strip()
        if c.text_w(trial, scale=3) > PX1 - PX0 - 80:
            c.text(120, y, line, MUTED, scale=3)
            y += 32
            line = word
        else:
            line = trial
    if line:
        c.text(120, y, line, MUTED, scale=3)

    ax0, ay0, ax1, ay1 = 120, PY1 - 250, PX1 - 40, PY1 - 44

    if logo:
        luma = average_luma(*logo)
        tile = DARK_TILE if (luma is not None and luma > 0.55) else LIGHT_TILE
        c.round_rect(ax0, ay0, ax1, ay1, 14, tile)
        c.frame(ax0, ay0, ax1, ay1, BORDER, 2)
        lw, lh, lrgba = logo
        maxw, maxh = (ax1 - ax0) - 110, (ay1 - ay0) - 64
        ratio = min(maxw / lw, maxh / lh)
        dw = max(1, min(maxw, int(lw * ratio)))
        dh = max(1, min(maxh, int(lh * ratio)))
        rw, rh, rrgba = resize_rgba(lw, lh, lrgba, dw, dh)
        c.blit(rw, rh, rrgba, ax0 + (ax1 - ax0 - dw) // 2, ay0 + (ay1 - ay0 - dh) // 2, 1)
    elif kind == "TRANSPORT":
        transport_art(c, ax0 + 26, ay0 + 20, ax1 - 26, ay1 - 20, seed)
    else:
        abstract_art(c, ax0 + 34, ay0 + 24, ax1 - 34, ay1 - 24, seed)

    c.png(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand-dir", default="brand")
    ap.add_argument("--out-name", default="1-card.png")
    args = ap.parse_args()

    loaded = {}
    for _folder, _n, _k, _t, key in ITEMS:
        if not key or key in loaded:
            continue
        p = os.path.join(args.brand_dir, key + ".png")
        if os.path.isfile(p):
            try:
                loaded[key] = png_decode(open(p, "rb").read())
                print(f"  loaded logo {key}: {loaded[key][0]}x{loaded[key][1]}")
            except Exception as exc:
                print(f"  SKIP {key}: {exc}", file=sys.stderr)
        else:
            print(f"  no logo for {key} -> abstract art")

    for seed, (folder, name, kind, tagline, key) in enumerate(ITEMS):
        d = os.path.join(folder, "screenshots")
        os.makedirs(d, exist_ok=True)
        out = os.path.join(d, args.out_name)
        build_card(out, name, kind, tagline, loaded.get(key), seed)
        legacy = os.path.join(d, "1-placeholder.png")
        if os.path.exists(legacy):
            os.remove(legacy)
        print(f"  {os.path.getsize(out):>7} bytes  {out}")


if __name__ == "__main__":
    main()
