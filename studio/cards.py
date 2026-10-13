"""Gera quadros 3840x2160 para o render.

  python3 studio/cards.py card    <out.png> "<texto>" ["<subtexto>"]   # cartão de título/data
  python3 studio/cards.py archive <out.png> <imagem> ["<legenda>"]     # foto/gravura de arquivo emoldurada
"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H = 3840, 2160
SERIF = '/System/Library/Fonts/Supplemental/Baskerville.ttc'
SANS = '/System/Library/Fonts/Supplemental/Futura.ttc'


def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except OSError:
        return ImageFont.truetype('/System/Library/Fonts/Supplemental/Times New Roman.ttf', size)


def dark_background():
    # Preto com leve luz central (vinheta invertida), igual aos cartões da referência.
    bg = Image.new('L', (W, H), 0)
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).ellipse((W * 0.2, H * 0.15, W * 0.8, H * 0.85), fill=48)
    bg = Image.composite(glow, bg, glow).filter(ImageFilter.GaussianBlur(320))
    return Image.merge('RGB', (bg, bg, bg))


def small_caps_width(draw, text, f_big, f_small):
    w = 0
    for ch in text:
        f = f_big if not ch.islower() else f_small
        w += draw.textlength(ch.upper(), font=f)
    return w


def draw_small_caps(draw, x, y, text, f_big, f_small, fill):
    # Versalete: maiúsculas grandes, minúsculas viram maiúsculas menores (estilo dos cartões de data).
    asc_big = f_big.getmetrics()[0]
    asc_small = f_small.getmetrics()[0]
    for ch in text:
        f = f_big if not ch.islower() else f_small
        dy = 0 if f is f_big else asc_big - asc_small
        draw.text((x, y + dy), ch.upper(), font=f, fill=fill)
        x += draw.textlength(ch.upper(), font=f)


def card(out, text, sub=None):
    img = dark_background()
    d = ImageDraw.Draw(img)
    lines = text.split('\\n') if '\\n' in text else [text]
    f_big, f_small = font(SERIF, 190), font(SERIF, 140)
    line_h = 230
    total = line_h * len(lines) + (140 if sub else 0)
    y = (H - total) / 2
    for line in lines:
        w = small_caps_width(d, line, f_big, f_small)
        draw_small_caps(d, (W - w) / 2, y, line, f_big, f_small, (236, 230, 216))
        y += line_h
    if sub:
        f_sub = font(SANS, 64)
        w = d.textlength(sub.upper(), font=f_sub)
        d.text(((W - w) / 2, y + 40), sub.upper(), font=f_sub, fill=(150, 142, 128))
    img.save(out)


def archive(out, src, caption=None):
    # Foto/gravura antiga: tom sépia, moldura clara, sombra, sobre fundo escuro. Mantém a proporção original.
    photo = Image.open(src).convert('RGB')
    gray = ImageOps.autocontrast(ImageOps.grayscale(photo), cutoff=1)
    toned = ImageOps.colorize(gray, black=(28, 22, 16), white=(238, 226, 200), mid=(140, 118, 90))
    max_w, max_h = W * 0.78, H * (0.68 if caption else 0.8)
    scale = min(max_w / toned.width, max_h / toned.height)
    toned = toned.resize((int(toned.width * scale), int(toned.height * scale)), Image.LANCZOS)
    border = 28
    framed = ImageOps.expand(toned, border=border, fill=(214, 204, 184))
    bg = dark_background()
    x = (W - framed.width) // 2
    y = (H - framed.height) // 2 - (60 if caption else 0)
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rectangle((x + 30, y + 40, x + framed.width + 30, y + framed.height + 40), fill=200)
    shadow = shadow.filter(ImageFilter.GaussianBlur(50))
    bg.paste((0, 0, 0), (0, 0, W, H), shadow)
    bg.paste(framed, (x, y))
    if caption:
        d = ImageDraw.Draw(bg)
        f = font(SERIF, 70, index=1)  # itálico
        w = d.textlength(caption, font=f)
        d.text(((W - w) / 2, y + framed.height + 50), caption, font=f, fill=(170, 160, 140))
    bg.save(out)


if __name__ == '__main__':
    kind, out, *rest = sys.argv[1:]
    if kind == 'card':
        card(out, rest[0], rest[1] if len(rest) > 1 and rest[1] else None)
    elif kind == 'archive':
        archive(out, rest[0], rest[1] if len(rest) > 1 and rest[1] else None)
    else:
        sys.exit(f'tipo desconhecido: {kind}')
