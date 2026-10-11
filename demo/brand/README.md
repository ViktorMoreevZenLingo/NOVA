# NOVA.Coach logo

Rebuilt from the project's brand definition (`NOVA_FE/components/ui/Brand.tsx` +
`globals.css` waveform, plus the pitch wordmark) — not a pixel grab. The `.svg`
files are the source of truth; the `.png`s are rendered from them (transparent, 3×).

| File | Use |
|------|-----|
| `nova-coach-logo.svg` / `.png` | Wordmark lockup, **dark ink** — for light backgrounds |
| `nova-coach-logo-light.svg` / `.png` | Wordmark lockup, **white ink** — for dark backgrounds |
| `nova-coach-icon.svg` / `.png` | App icon — waveform on a rounded dark tile |
| `nova-coach-icon-512.png` / `-1024.png` | Larger icon raster (app stores, favicons) |

Accent dot `#8aa6ff` · ink `#191919` · icon tile `#181818` · font SF Pro Display 650 / −2 tracking.

Re-render PNGs after editing an SVG (needs Google Chrome):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --default-background-color=00000000 --force-device-scale-factor=3 --window-size=250,64 \
  --screenshot=nova-coach-logo.png "file://$PWD/nova-coach-logo.svg"
```
