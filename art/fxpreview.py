"""把 fx.py 的代码特效用代码版垫子渲染一遍到 out/fx/（预览）。"""
import sys
from PIL import Image
from pix import *
import fx
src = sys.argv[1] if len(sys.argv) > 1 else 'out/discs/code-'
d = {k: Image.open(f'{src}{k}.png') for k in ['back', 'rose', 'skull', 'lc-down', 'lc-up']}
mat = Image.open(PUBLIC / 'mats/mat-0-blank.png')
res = {'flip-rose': fx.flip(d['back'], d['rose']), 'flip-skull': fx.flip(d['back'], d['skull']),
       'flip-lc': fx.flip(d['lc-down'], d['lc-up'], ('#dde2ea', '#8a8f9b')),
       'lose': fx.lose(d['back']), 'skull-hit': fx.skull_hit(), 'rose-pop': fx.rose_pop(), 'success': fx.success(),
       'mat-win': fx.mat_win(mat), 'petals': fx.petals(), 'sparkle': fx.sparkle()}
for k, v in res.items():
    v.save(f'out/fx/code-{k}.png')
    sc = 4 if v.height <= 64 else 3
    up(on_bg(v), sc).save(f'out/fx/code-{k}-x{sc}.png')
    up(on_bg(v, '#f3ead8'), sc).save(f'out/fx/code-{k}-day-x{sc}.png')
print('ok')
