# LLM Arcade model file schema

Contents: [File shape](#file-shape) · [Top-level fields](#top-level-fields) · [Blocks](#blocks) · [Pieces](#pieces) · [Piece kinds](#piece-kinds-and-what-they-draw) · [Mapping diagram boxes](#mapping-raschka-diagram-boxes-to-kinds) · [Quiz](#quiz) · [Patterns for tricky architectures](#patterns-for-tricky-architectures) · [Adding a new kind](#adding-a-new-kind-to-the-engine)

## File shape

`app/models/<id>.js` contains exactly one call with **strict JSON** inside (double quotes, no comments, no trailing commas), so the validator can parse it:

```js
LLMArcade.register({ ... });
```

Then add `"<id>"` to `app/models/manifest.js` (the array order is the cartridge order on the title screen).

## Top-level fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | lowercase slug, equals the file name. e.g. `qwen3-235b-a22b` |
| `name` | string | Cartridge title. e.g. `"Qwen3 235B-A22B"` |
| `maker`, `year` | string, number | Shown on the cartridge |
| `cartColor` | hex | Cartridge label color. Pick one not used by neighbors |
| `tagline` | string | One playful sentence: the model's signature move |
| `intro` | string | First dialog line when the level opens. Point at what to look for |
| `source` | string | Credit, e.g. `"Sebastian Raschka, The Big LLM Architecture Comparison (Kimi K2 diagram)"` |
| `d` | number | Hidden size (embedding dim). Used in narration and packet shape labels |
| `vocab` | number | Vocabulary size. Used in narration |
| `stats` | `[[label, value], ...]` | 4 short chips for the cartridge: e.g. `["TOTAL","1T"], ["ACTIVE","32B"], ["LAYERS","61"], ["EXPERTS","384"]` |
| `blocks` | array | See below |
| `pieces` | array | Ordered **input → output**, the way data flows (bottom → top on Raschka's diagrams) |
| `quiz` | array | Hand-written questions (the engine adds auto-generated ones on top) |
| `demo` | object, optional | `{ "prompt": ["The"," cat",...], "continuation": [" mat",".",...] }`, the toy sentence for RUN. Tokens keep their leading spaces |

## Blocks

```json
"blocks": [ { "id": "main", "repeat": 32, "label": "TRANSFORMER BLOCK" } ]
```

A block is the boxed region on the diagram with "×N" next to it. Each block becomes its own room (mint floor, walls, a sign reading `xN LABEL`), and during RUN the token loops through it twice, then fast-forwards to N. Use several blocks when the diagram shows different block types stacked (DeepSeek V3: 3 dense, then 58 MoE). Pieces in a block must be listed contiguously.

## Pieces

Common fields:

| Field | Notes |
|---|---|
| `id` | unique, short (`norm1`, `attn`, `moe`) |
| `kind` | one of the kinds below; decides the 3D model and default teaching text |
| `name` | label shown in 3D and in the inspector. Use the diagram's wording when it's clear (`"Grouped-Query Attention"`) |
| `block` | block id, if the piece is inside the repeated block |
| `variant` | sub-type shown in the inspector header and used for visuals (see kinds) |
| `blurb` | one sentence: what it does. Optional; the kind default is good for standard parts |
| `detail` | 2-4 sentences: how it works. Override when this model does something different |
| `analogy` | an everyday "think of it like..." comparison |
| `facts` | `[[label, value], ...]`, the model-specific numbers. This is where the diagram's annotations go |
| `special` | what is distinctive about this piece in this model vs. others. Include it for every piece that differs from GPT-2/Llama norms. It is the most valuable text on the page |
| `flow` | optional narration override used during RUN. Placeholders: `{word} {id} {d} {hidden} {cache} {k} {experts} {vocab} {next} {layer} {layers}` |
| `color` | optional hex override |

## Piece kinds and what they draw

| kind | 3D model | Extra fields |
|---|---|---|
| `tokenizer` | orange slicer machine with hopper. Clicking it plays the grinder demo: the prompt's words drop in and token cubes with IDs line up in front | `tokenizerDemo` (optional): `[{"text": " unhappiness", "tokens": [" un", "happiness"]}, ...]` to show this tokenizer's real splits. The default is the demo prompt plus " windowsill" → " window" + "sill", finishing the sentence. If you override it, keep the words a readable sentence with one split word near the end |
| `embedding` | bookshelf of colored vector cubes. Clicking it plays the lookup demo: the table appears as a matrix wall (vocab × `d`), each token from the grinder scrolls it to its row, and the copied rows build a second wall, the sentence matrix (tokens × `d`) | none. It reuses the tokenizer's demo words (`tokenizerDemo`) and the top-level `d`/`vocab`, so set those correctly |
| `posenc` | clock box: a separate learned/absolute position embedding (GPT-2 style). Don't add it for RoPE models | none |
| `norm` | teal plate with equalizer bars that level out | `variant`: `layernorm` / `rmsnorm` |
| `attention` | blue unit: yellow query-head windows on the front, orange K/V blocks on top, KV-cache rack behind. Clicking it plays the spotlight demo, which reads `heads`, `kvHeads`, `variant`, `window` and `windowShow`, so wrong values show up as wrong teaching | `variant`: `mha` `gqa` `mqa` `mla` `sliding` `alternating`; `heads`, `kvHeads`; `rope` (spinning ring); `qkNorm` (teal plates); `sinks` (black cube); `window` (tokens) and `windowShow` (how many cache slots the demo beams to on sliding layers, 2-3) |
| `add` | yellow round node with a "+" | `residualFrom`: id of the piece where the bypass branches off, i.e. the first piece of the sub-layer it skips (normally the norm before attention/FFN). Draws the gold bypass pipe and runs the ghost packet |
| `ffn` | green unit with a fan; two intake pipes if the variant is gated | `variant`: `gelu` / `swiglu` / `geglu` / `relu`; `hidden` (intermediate size) |
| `moe` | router box + grid of expert cabinets (max 16 drawn) + optional orange shared expert | `experts`, `active` (top-k), `shared` (true/false), `expertHidden` (optional: one expert's intermediate size, used by the workshop's size meters) |
| `lmhead` | red panel of logit bars | none |
| `sampler` | slot machine; pops out the next token | none |
| `custom` | colored box with a spinning gem | must supply `blurb`, `detail`, and ideally `color`. Use for anything without a kind (MTP head, vision encoder, DeltaNet, Mamba, ...) |

`variant: "alternating"` means odd layers use the sliding window and even layers use full attention. `sliding` means the sliding-window flavor is the one shown; describe any global layers in `detail`/`facts` (Gemma 3: 5 local : 1 global).

## Mapping Raschka diagram boxes to kinds

Raschka's architecture figures read bottom-to-top. Typical box labels and what they become:

| Diagram box | kind / settings |
|---|---|
| "Tokenized text" / "Tokenizer" | `tokenizer` |
| "Token embedding layer" | `embedding` |
| "Positional embedding layer" (absolute) | `posenc` |
| "RoPE" shown inside or next to attention | no piece; set `"rope": true` on the attention |
| "LayerNorm" / "RMSNorm" (pre) | `norm` with `variant` |
| "RMSNorm" after a sub-layer (Gemma, OLMo 2 post-norm) | another `norm`, placed after the sub-layer, before the add |
| "Masked multi-head attention" | `attention`, `variant: "mha"` |
| "Grouped-query attention" | `attention`, `gqa`, with `heads` and `kvHeads` |
| "Multi-head latent attention" | `attention`, `mla` |
| "Sliding window attention" (+ "global" ratio) | `attention`, `sliding` or `alternating`, with `window` |
| "QK-Norm" inside attention | `"qkNorm": true` |
| The "⊕" circle where the skip arrow rejoins | `add` with `residualFrom` |
| "Feed forward" / "FeedForward (SiLU/GELU)" | `ffn` with `variant` + `hidden` |
| "MoE" / "Router" + "Expert" boxes (+ "Shared expert") | one `moe` piece with `experts`, `active`, `shared` |
| "Final norm" | `norm` outside any block |
| "Linear output layer" | `lmhead` |
| (implied) softmax / sampling | `sampler`, always add one so RUN can emit a token |
| Repeated region "×N" | a `blocks` entry with `repeat: N` |
| Dimension call-outs ("Embedding dim 4,096", "Intermediate hidden 14,336", "Vocab 151k", "Context 128k", "32 heads", "8 KV groups") | `facts` on the relevant piece, plus top-level `d`, `vocab`, `stats` |

## Quiz

```json
{ "type": "choice", "piece": "attn", "q": "...", "options": ["...", "...", "...", "..."], "answer": 1, "explain": "..." }
{ "type": "find", "q": "Click the piece that ...", "answer": "moe", "explain": "...", "acceptBlock": false }
```

- `choice`: 2-4 options, `answer` is an index. The engine shuffles option order, so write them in any order.
- `find`: the player clicks a piece in 3D. `answer` is a piece id. Pieces with the same `name` also count; `acceptBlock: true` accepts any piece in the same block (for "click the floor that..." questions).
- `piece` links the question to a piece so the inspector's QUIZ ME button can use it.
- The engine also auto-generates a "find the piece that <blurb>" and a "what does X do?" for every piece, so hand-written questions should go deeper: numbers, trade-offs, comparisons.

## Patterns for tricky architectures

- **Two block types stacked** (dense layers first, then MoE): two blocks, each with its own pieces. See `deepseek-v3.js` in the bundled app.
- **Interleaved layer types** (e.g. 3 linear-attention layers then 1 full-attention layer, repeated): make one block holding the whole repeating unit, so its pieces are the 3 linear layers' pieces followed by the full layer's pieces, with `repeat` = total layers ÷ unit size. Say so in the block `label` (`"3x DELTANET + 1x ATTN"`).
- **Shared expert**: `"shared": true` on the `moe` piece. Don't model it as a separate piece.
- **Multi-token prediction / auxiliary heads**: mention in `facts` of the LM head. Only add a `custom` piece if the diagram makes it central, and put it after the `lmhead`.
- **No-norm or norm-free designs, parallel attention+FFN blocks**: the engine is a linear pipeline. Approximate with sequential pieces and explain the real wiring in `detail` and `special`. Never draw something misleading silently.
- **Multimodal** (vision encoder feeding the LLM): a `custom` piece before the embedding, named e.g. "Vision Encoder", with an honest `detail`.

## Adding a new kind to the engine

Only if `custom` would undersell a component that will recur across models (e.g. a "Mamba" or "DeltaNet" kind). In `engine.js`:
1. Add an entry to `KINDS` (`color`, `title`, `tag`, `icon`, `blurb`, `detail`, `analogy`, `flow(c)`).
2. Add a builder to `BUILD` that composes `b.box(w,h,d,color,x,y,z)` / `b.cyl(...)` voxels and returns `{ top, anim(t, dt, active, progress) }`. Keep footprints under about 3×3 units so the spacing still works.
3. Add the kind to `KINDS` in `scripts/validate_model.py`.

## Adding a click demo

The tokenizer grinder (`startGrind`/`updateGrind`/`stopGrind`), the embedding lookup (`startEmb`/`updateEmb`/`stopEmb`) and the attention spotlight (`startAtt`/`updateAtt`/`stopAtt`) in `engine.js` are the templates. For a demo with several explained stages, copy the attention one: it keeps a stage index, a duration per stage (`ATT_DUR`) and a text per stage, and it shares the dialog's NEXT button with RUN (`showNext`, `advance`), so STEP/AUTO pacing works for free. A demo:
1. builds its meshes in a group added to the piece's own group (`o.g`), so positions are local to the piece;
2. calls `setFocus(o)` so other labels hide, and `collapseInspector()` so the narrow-screen sheet folds away;
3. frames the camera through `cam.goal` (target, radius, phi, theta), using wider framing when `W < 820`;
4. places HTML labels each frame with `placeLabel(div, worldPos, 'above' | 'left' | 'right' | 'below')`;
5. is started from `select()` for its piece kind, stopped when another piece is selected (and in `clearWorld`), updated from the main loop, and gets a REPLAY button in `renderInspector`.

Reuse the demo words (`grindWords`) and `slotColor(token)` so tokens keep the same color and ID across demos, the KV cache and the RUN flow.
