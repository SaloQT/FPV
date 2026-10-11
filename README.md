# FPV Sim

Fly an FPV racing drone in your browser.

Realistic drone physics, generated race tracks through forests and hills, a working theme park, day and night, and AI pilots you can race or train yourself.

## Run it

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** and click **Click to fly**.

## You need

- **Chrome or Edge** (version 113 or newer), with hardware acceleration on.
- **Node.js 22** or newer.
- Open it on **localhost**, not your network IP. WebGPU only works on localhost or HTTPS.

## Fly

| Key | Does |
| --- | --- |
| Mouse | Roll and pitch (click the screen first) |
| W / S | Throttle up / down |
| A / D | Yaw |
| Space | Arm / disarm |
| R | Back to the last gate |
| C | Change camera |
| Esc | Menu and settings |
| F1 | All controls |

Gamepads and USB radio controllers work too.

## Try these

- **Theme park race:** http://localhost:5173/?world=theme-park&route=race
- **Watch the AI race:** http://localhost:5173/?race=ace,ultimate1,a
- **Let an AI fly for you:** http://localhost:5173/?brain=smooth-a
- **Best graphics (needs a strong GPU):** http://localhost:5173/?quality=extreme
- **Build your own track:** http://localhost:5173/?mode=builder
- **Design propellers:** http://localhost:5173/?mode=proplab

## Train an AI pilot

```bash
npm run train
```

This opens the training dashboard at **http://localhost:8787**. Pick a template, then press **Start run**. It trains on your GPU.

## Check it works

```bash
npm run typecheck
npm test
```

## More

- [Full reference](docs/reference.md): every feature, setting and URL option.
- [AGENTS.md](AGENTS.md): how to work on the code, for people and AI agents.
- [TASKS.md](TASKS.md): what's being worked on next.
