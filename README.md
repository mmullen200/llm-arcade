# LLM Arcade

8-bit 3D learning levels for LLM architectures, based on Sebastian Raschka's architecture diagrams.

Run it: open `index.html` in a browser, or serve the folder with `python3 -m http.server 8765` and go to http://localhost:8765.

Add a model: write `models/<id>.js` (`LLMArcade.register({...})`), add the id to `models/manifest.js`, then run `python3 <llm-arcade skill>/scripts/validate_model.py models`. The `llm-arcade` skill does all of this for you from a diagram.

Controls: click = inspect, drag = rotate, WASD / arrow keys = move around, wheel = zoom, Space = run / next stop, R = recenter, Q = quest, F = follow cam.

The Workshop (title screen) lets you build an LLM from the parts: rebuild real models from blueprints, or invent one in free build with live size/KV-cache meters, a "looks like" detector and challenges. It lives in `workshop.js`.

## Repository layout

- The web app is at the root (`index.html`, `engine.js`, `workshop.js`, `style.css`, `models/`). It has no build step: serve the folder (`python3 -m http.server 8765`) or open `index.html` directly.
- `skill/` is the `llm-arcade` Claude skill, which turns Sebastian Raschka's LLM architecture diagrams into new cartridges. It bundles its own copy of the app in `skill/assets/app/`.

Architectures follow the LLM diagrams by Sebastian Raschka ([The Big LLM Architecture Comparison](https://magazine.sebastianraschka.com/p/the-big-llm-architecture-comparison)). This is a fan-made learning toy and is not affiliated with him.
