#!/usr/bin/env python3
"""Gera ícones e telas de abertura (Android/iOS) e o logo do site a partir de assets/logo-source.png.
Uso: python3 scripts/make-icons.py   (precisa de Pillow). Rode de novo se o logo mudar."""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.join(HERE, '..')
WEB_PUBLIC = os.path.join(MOBILE, '..', 'web', 'public')
ADMIN_PUBLIC = os.path.join(MOBILE, '..', 'admin', 'public')
RES = os.path.join(MOBILE, 'android', 'app', 'src', 'main', 'res')
IOS = os.path.join(MOBILE, 'ios', 'App', 'App', 'Assets.xcassets')
BLACK = (0, 0, 0, 255)

src = Image.open(os.path.join(MOBILE, 'assets', 'logo-source.png')).convert('RGBA')

def fit(size: int, scale: float = 1.0, background=BLACK) -> Image.Image:
    """Logo centralizado ocupando `scale` do lado, sobre fundo `background` (None = transparente)."""
    canvas = Image.new('RGBA', (size, size), background if background else (0, 0, 0, 0))
    inner = max(1, round(size * scale))
    logo = src.resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(logo, ((size - inner) // 2, (size - inner) // 2))
    return canvas

def rounded(img: Image.Image, radius_ratio: float) -> Image.Image:
    size = img.size[0]
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=round(size * 4 * radius_ratio), fill=255)
    out = img.copy()
    out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out

def save(img: Image.Image, path: str, rgb: bool = False) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    (img.convert('RGB') if rgb else img).save(path, optimize=True)

# Site: logo da tela de entrada, favicon e ícone de tela inicial.
save(rounded(fit(512), 0.2237), os.path.join(WEB_PUBLIC, 'logo.png'))
save(fit(180), os.path.join(WEB_PUBLIC, 'apple-touch-icon.png'), rgb=True)
save(rounded(fit(64), 0.2237), os.path.join(WEB_PUBLIC, 'favicon.png'))
save(rounded(fit(64), 0.2237), os.path.join(ADMIN_PUBLIC, 'favicon.png'))

# Android: ícone antigo (quadrado arredondado), redondo e adaptivo (logo a 62% para caber na zona segura).
for dpi, legacy, adaptive in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
    folder = os.path.join(RES, f'mipmap-{dpi}')
    save(rounded(fit(legacy), 0.2), os.path.join(folder, 'ic_launcher.png'))
    save(rounded(fit(legacy), 0.5), os.path.join(folder, 'ic_launcher_round.png'))
    save(fit(adaptive, 0.62, background=None), os.path.join(folder, 'ic_launcher_foreground.png'))
with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n')

# Telas de abertura: fundo preto com o logo a 40% da menor lado, mantendo o tamanho de cada arquivo existente.
def splash(path: str, scale: float = 0.4) -> None:
    w, h = Image.open(path).size
    canvas = Image.new('RGBA', (w, h), BLACK)
    inner = round(min(w, h) * scale)
    canvas.alpha_composite(src.resize((inner, inner), Image.LANCZOS), ((w - inner) // 2, (h - inner) // 2))
    canvas.convert('RGB').save(path, optimize=True)

for root, _dirs, files in os.walk(RES):
    for name in files:
        if name == 'splash.png':
            splash(os.path.join(root, name))
splash_dir = os.path.join(IOS, 'Splash.imageset')
for name in os.listdir(splash_dir):
    if name.endswith('.png'):
        splash(os.path.join(splash_dir, name))

# iOS: ícone único de 1024 sem transparência (a Apple arredonda sozinha).
save(fit(1024), os.path.join(IOS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), rgb=True)
print('ok')
