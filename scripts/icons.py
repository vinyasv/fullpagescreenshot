from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "icons"
root.mkdir(exist_ok=True)
for size in (16, 48, 128):
    scale = 4
    n = size * scale
    image = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, n - 1, n - 1), radius=n // 5, fill="#302f2b")
    width = max(3, n // 13)
    draw.rectangle((n * .22, n * .28, n * .68, n * .76), outline="#f6f1e7", width=width)
    draw.line((n * .42, n * .2, n * .79, n * .2, n * .79, n * .58), fill="#e56142", width=width)
    draw.polygon([(n * .79, n * .7), (n * .66, n * .52), (n * .92, n * .52)], fill="#e56142")
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f"icon{size}.png")
