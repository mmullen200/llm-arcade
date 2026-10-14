---
name: llm-arcade
description: Turn Sebastian Raschka's LLM architecture diagrams (GPT-2, Llama, Qwen, Gemma, DeepSeek, gpt-oss, Kimi, OLMo, Mistral, and so on) into playable 8-bit 3D learning levels in the "LLM Arcade" web app. Every component becomes a voxel block you can inspect and be quizzed on, and a token visibly flows through the system (residual bypasses, KV cache, MoE routing, layer loops). Use this whenever someone shares an LLM architecture diagram or screenshot, names a model they want to "see", "explore", "learn", "visualize" or "turn into a game/interactive/quiz", wants to add a model to the arcade, or wants a fun, gamey explainer of how a specific transformer or MoE model works, even if they don't say "arcade" or "Raschka".
---

# LLM Arcade

LLM Arcade is a static web app (three.js, no build step) where each LLM is a "cartridge". Picking one loads an 8-bit-styled 3D factory floor: the model's components are voxel machines connected by pipes, laid out in input → output order, with the repeated transformer block shown as a room labelled `xN`. Players can:

- click a piece for an RPG-style inspector (what it does, how, an analogy, this model's numbers, what's special),
- click the **tokenizer** to watch the grinder demo (the demo sentence drops in word by word and comes out as numbered token cubes, with one word splitting into two tokens), the **token embedding** to watch the lookup demo (the table appears as a vocab × d matrix wall, scrolls like a slot reel to each token's row, and the copied rows build the sentence matrix), and an **attention** unit to watch the spotlight demo (8 stepped stages: the sentence on stage, Q/K/V gems, one head's query-key scores, softmax, the weighted blend of values, several heads as a 3D attention heatmap, how this model shares or compresses K/V, and the merge back into the unit). The attention demo adapts to the model: GQA groups, MLA compression, and greyed-out tokens outside a sliding window. Demos follow the same STEP/AUTO pacing as RUN. While a demo plays, unrelated labels hide (focus mode) and, on narrow screens, the inspector folds down to its header,
- rotate the view by dragging, move around the map with WASD or the arrow keys (two-finger drag on touch screens), and zoom with the wheel or a pinch. The layout is fixed: pieces stay in their real data-flow order, so the picture always matches the simulation,
- press RUN to watch a token travel through, paced for humans (STEP mode waits for NEXT at every stop like an RPG dialog; AUTO holds each stop for its reading time; layer 2 is a quick replay and later tokens take an express trip): tokenizer → embedding → loops through the block (residual bypass ghost, KV-cache beams, MoE router lighting up experts) → fast-forward through the remaining layers → logits → sampler pops out the next word, which feeds back in,
- play a QUEST: multiple-choice questions plus "find it in 3D" questions where they click the right piece, with hearts, coins and XP,
- enter THE WORKSHOP (`workshop.js`) to build an LLM from the same parts. **Blueprints** rebuild a real cartridge slot by slot: each empty slot describes its job, the player picks the part, then its type (MHA/GQA/MLA, LayerNorm/RMSNorm, GELU/SwiGLU, shared expert), earning up to 3 stars. **Free build** is a sandbox, started empty or by remixing any cartridge. A foreman checks the wiring in plain language, meters estimate parameters, active parameters per token and KV cache at 128K, a detector names the closest cartridge and what would make the build match it, and four challenges set goals. TEST RUN sends a token through the finished build with the normal RUN engine.

**All model-specific content lives in one data file per model.** Adding a model means writing `models/<id>.js` and listing it in `models/manifest.js`, not touching the engine.

## Files in this skill

- `assets/app/` is the complete app: `index.html`, `engine.js`, `workshop.js`, `style.css`, `models/` (8 example models: GPT-2, Llama 3 8B, Gemma 3 27B, Qwen3 235B-A22B, DeepSeek V3, gpt-oss-120b, OLMo 2 7B, Kimi K2).
- `references/schema.md` covers every field, the piece kinds and their 3D visuals, a table mapping Raschka diagram boxes to kinds, and patterns for unusual architectures. **Read it before writing a model file.**
- `references/writing-guide.md` covers the teaching voice, field lengths, accuracy rules, copyright and quiz design. **Read it before writing text or questions.**
- `scripts/validate_model.py` checks a model file or the whole `models/` folder.

## Workflow

### 1. Find or create the app

If the user already has an LLM Arcade folder (look for `engine.js` next to `models/manifest.js`), work there. Otherwise copy `assets/app/` to where they want the app, e.g. `./llm-arcade/`. If they only want to see it, the eight bundled cartridges already work.

### 2. Read the diagram

The input is usually an image of one of Raschka's architecture figures (from "The Big LLM Architecture Comparison", "From GPT-2 to gpt-oss", his LLMs-from-scratch repo, or his social posts), sometimes a link or just a model name.

- Read the figure bottom-to-top and write out the box sequence, which boxes sit inside the `xN` region, where the skip arrows branch off and rejoin, and every annotation (embedding dim, hidden/intermediate dim, heads, KV groups, experts, active experts, vocab, context length, sliding window sizes).
- If the figure compares two models side by side, ask which one to build, or build both as separate cartridges.
- Fill gaps from the model's official config.json or model card, or Raschka's article text, when you can access them. Prefer leaving a number out to guessing; a learning tool that teaches wrong numbers does harm.
- With only a model name and no diagram, reconstruct the architecture from the config and the article, and tell the user the level is based on the published config rather than a specific figure.

### 3. Map boxes to pieces

Use the mapping table in `references/schema.md`. The usual shape is:

```
tokenizer → embedding → [posenc?] → BLOCK xN { norm → attention → add, norm → ffn|moe → add } → final norm → lmhead → sampler
```

Things to get right, because they are the point of the visualization:
- `residualFrom` on each `add` points at the first piece of the sub-layer being skipped (usually its pre-norm). That draws the gold bypass pipe.
- Attention `variant`, `heads` and `kvHeads` must match the model: the query windows and K/V blocks are drawn from them, and the GQA/MLA/sliding story is told through them.
- MoE `experts`, `active` and `shared` drive the router animation.
- Different stacked block types become separate `blocks`.
- Anything without a kind becomes `custom`, with honest text.

### 4. Write the model file

Create `models/<id>.js` per the schema, add the id to `models/manifest.js`, and bump the `?v=N` tags in `index.html` so browsers pick up the new cartridge. Follow `references/writing-guide.md`:
- `special` on every piece that differs from the GPT-2/Llama baseline, comparing it with the other cartridges by name. This is what makes each level worth playing.
- `facts` carry the diagram's numbers in plain-language labels.
- `intro` tells the player what to look for on this level.
- 6-8 quiz questions, at least 2 of them `find`, each with an `explain`.
- `source` credits the Raschka figure/article it came from.

Use `assets/app/models/llama3-8b.js` (a simple dense model), `olmo2-7b.js` (post-norm: the residual branches at the attention unit itself) and `deepseek-v3.js` / `kimi-k2.js` (two block types, MLA, shared expert; Kimi's dense block has `repeat: 1`) as worked examples.

### 5. Validate

```bash
python3 <skill-dir>/scripts/validate_model.py <app>/models
```

Fix every ERROR. Treat WARNs as a checklist: most of them point to missing teaching value.

### 6. Play-test it

Serve the folder (`python3 -m http.server 8765 --directory <app>`) or open `index.html` directly, since it works from `file://` too. If you have a browser tool, actually check:
1. The cartridge appears on the title screen and opens without console errors.
2. The layout reads correctly: rows in order, the block room with the right `xN`, bypass pipes landing on the right `+` nodes.
3. RUN completes a full token in STEP mode (press NEXT through every stop; the sampler pops the next word). Narration for each stop should be readable in the time AUTO gives it, so keep `flow` text to one or two sentences.
4. Click the tokenizer, the token embedding and an attention unit: the grinder sentence should read naturally and the split word should come out as several tokens; the lookup should end with "YOUR SENTENCE: n x d" showing this model's real `d`; the attention demo's sharing step should state this model's real heads / K/V heads (or MLA / sliding window).
5. Start a QUEST and answer one `find` question by clicking.

6. Open THE WORKSHOP: the new model appears automatically as a blueprint and as a remix starting point (only if it uses standard kinds; a `custom` piece keeps it out of the workshop). Remix it and check that the detector says 100% for its own name and that the meters are in the right ballpark for its published size. For MoE models, set `expertHidden` on the `moe` piece, or the size estimate falls back to a guess.

Then tell the user what's distinctive about the new level and how to open it.

## Changing the engine or the look

The engine (`engine.js`) is one readable file. Pixelation comes from rendering at 1/2 or 1/3 resolution with `image-rendering: pixelated`, plus a 3-band toon ramp and soft dark edge outlines on every voxel. To keep it from shimmering ("sizzling") when the camera rotates, keep MSAA on (`antialias: true`), keep mipmaps + anisotropy on tiled textures, and avoid pure-black 1px lines or sub-pixel details. The PX button in the top bar lets players pick chunky / medium / fine pixels. Fonts are Press Start 2P (UI) and VT323 (body text). Keep that style when extending it. To add a new 3D piece type or a new click demo, see "Adding a new kind" and "Adding a click demo" in `references/schema.md`. The workshop lives in `workshop.js` and talks to the engine only through the `api` object passed to `LLMArcade.workshop(api)`. It turns a build into an ordinary model object, so it renders and runs like a cartridge. After any change to `engine.js`, `workshop.js`, `style.css`, the manifest or a model file, bump the `?v=N` on the links in `index.html` (they all use the same number, and model files inherit the engine's tag). Otherwise browsers keep serving the old cached copy, and a new cartridge won't appear. Progress (XP, coins, inspected pieces, best scores) is stored in `localStorage` under `llm-arcade-v1`.
