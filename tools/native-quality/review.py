"""Produce visual review sheets; metrics always use the original native pixels."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('--baseline', required=True, type=Path)
ap.add_argument('--candidate', type=Path)
ap.add_argument('--out', required=True, type=Path)
args = ap.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
records = [json.loads(args.baseline.read_text())]
roots = [args.baseline.parent]
if args.candidate:
    records.append(json.loads(args.candidate.read_text())); roots.append(args.candidate.parent)

def image(side, frame):
    snap = next(s for s in records[side]['snapshots'] if s['frameIndex'] == frame)
    return Image.frombytes('RGBA', (snap['width'], snap['height']), (roots[side]/snap['imageFile']).read_bytes()).convert('RGB')

frames = [0, 59, 119, 179, 209, 239, 269, 299, 329, 359, 389, 419, 449, 472, 479]
sheet = Image.new('RGB', (1920, 5*384), '#151515')
draw = ImageDraw.Draw(sheet)
for i, frame in enumerate(frames):
    x, y = (i % 3)*640, (i//3)*384
    sheet.paste(image(0, frame).resize((640, 360)), (x, y+24))
    draw.text((x+6, y+5), f'Original frame {frame} (overview only)', fill='white')
sheet.save(args.out/'overview.jpg', quality=95)
if args.candidate:
    # Native 1:1 strips cover the complete width at lower, middle and distant
    # scene levels, without resampling. Original above candidate in each sheet.
    for frame in [119, 179, 239, 299, 359, 419, 479]:
        for name, box in [('distant', (0, 480, 3840, 992)), ('near', (0, 1400, 3840, 1912))]:
            sheet = Image.new('RGB', (3840, 1072), '#151515')
            draw = ImageDraw.Draw(sheet)
            for side in range(2):
                draw.text((8, side*536+6), f'{["Original", "Candidate"][side]} frame {frame}; {name}; native pixels', fill='white')
                sheet.paste(image(side, frame).crop(box), (0, side*536+24))
            sheet.save(args.out/f'{frame}-{name}.png')
    # Native crops for every frame of all four consecutive bursts. Inspect the
    # actual motion in both sequences; temporal-residual metrics are separate.
    for start in [180, 300, 400, 472]:
        for part in range(2):
            sheet = Image.new('RGB', (2048, 1072), '#151515')
            draw = ImageDraw.Draw(sheet)
            for side in range(2):
                for k in range(4):
                    frame = start+4*part+k
                    draw.text((k*512+6, side*536+6), f'{["Original", "Candidate"][side]} {frame}; native crop', fill='white')
                    sheet.paste(image(side, frame).crop((1664, 1100, 2176, 1612)), (k*512, side*536+24))
            sheet.save(args.out/f'burst-{start}-{part}.png')
