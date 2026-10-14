/* LLM Arcade engine.
 * Model files call LLMArcade.register({...}) — see models/*.js and the schema in the llm-arcade skill.
 * Classic script (not a module) so index.html also works when opened straight from disk. */
(function () {
'use strict';

const MODELS = [];
// model files load with the same ?v= tag as this script, so bumping it in index.html refreshes everything
const VER = (document.currentScript && document.currentScript.src.includes('?')) ? document.currentScript.src.slice(document.currentScript.src.indexOf('?')) : '';
window.LLMArcade = { register(m) { MODELS.push(m); } };

// ---------------------------------------------------------------- utils
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const tokText = (t) => JSON.stringify(t.replace(/^ /, '␣'));
const num = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
function loadScript(src) {
  return new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(true); s.onerror = () => { console.warn('LLM Arcade: could not load', src); res(false); }; document.head.appendChild(s); });
}

// ---------------------------------------------------------------- save data
const STORE_KEY = 'llm-arcade-v1';
let save = { xp: 0, coins: 0, muted: false, models: {} };
try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && typeof s === 'object') save = Object.assign(save, s); } catch (e) { /* private mode etc. */ }
function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
function mstate(id) { save.models[id] = save.models[id] || { seen: [], best: 0, total: 0 }; return save.models[id]; }

// ---------------------------------------------------------------- chiptune sfx
let actx = null;
function tone(f, d = 0.08, type = 'square', vol = 0.05, slide = null, delay = 0) {
  if (save.muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + 0.02);
  } catch (e) { /* audio unavailable */ }
}
const sfx = {
  select: () => { tone(660, 0.05); tone(990, 0.08, 'square', 0.04, null, 0.05); },
  coin: () => { tone(988, 0.07); tone(1319, 0.25, 'square', 0.05, null, 0.07); },
  wrong: () => tone(190, 0.32, 'sawtooth', 0.05, 70),
  tick: () => tone(1100, 0.025, 'square', 0.012),
  whoosh: () => tone(180, 0.22, 'triangle', 0.06, 900),
  grind: () => { for (let i = 0; i < 6; i++) tone(70 + Math.random() * 140, 0.05, 'sawtooth', 0.035, null, i * 0.05); },
  plink: () => tone(1300, 0.05, 'square', 0.025, 1900),
  pop: () => { tone(523, 0.06); tone(784, 0.06, 'square', 0.05, null, 0.06); tone(1047, 0.12, 'square', 0.05, null, 0.12); },
  levelup: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.1, 'square', 0.05, null, i * 0.08)),
  start: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.08, 'square', 0.05, null, i * 0.07)),
};

// ---------------------------------------------------------------- piece kinds
// Defaults for every kind. A model file can override any text field per piece.
const KINDS = {
  tokenizer: { color: '#ffa300', title: 'Tokenizer', tag: 'INPUT', icon: 'T',
    blurb: 'Chops raw text into tokens (word pieces) and swaps each one for an ID number.',
    detail: 'Text is split into sub-word chunks using a fixed vocabulary learned before training (usually BPE). Common words become one token; rare words get split into several. The model never sees letters, only these ID numbers.',
    analogy: 'A deli slicer for sentences: text goes in the top, numbered slices come out the side.',
    flow: (c) => `${c.word} drops into the hopper and comes out as token #${c.id}.` },
  embedding: { color: '#b06bff', title: 'Token Embedding', tag: 'LOOKUP', icon: 'E',
    blurb: 'Looks up each token ID in a giant table and pulls out a vector: a long list of numbers that stands for its meaning.',
    detail: 'The embedding table has one row per vocabulary entry. Row #ID is copied out as the token\'s starting vector. These numbers are learned during training, so tokens with similar meanings end up with similar vectors.',
    analogy: 'A library where every token has its own shelf holding a "meaning card" covered in numbers.',
    flow: (c) => `Token #${c.id} grabs its row from the table. It is now a vector of ${num(c.d)} numbers.` },
  posenc: { color: '#ffccaa', title: 'Position Embedding', tag: 'POSITION', icon: 'P',
    blurb: 'Adds a "where am I in the sentence?" signal to each token vector.',
    detail: 'Attention by itself has no sense of order. A learned position vector (one per slot) is added to the token vector, so "dog bites man" and "man bites dog" look different.',
    analogy: 'Seat numbers stamped on concert tickets: same person, different seat, different experience.',
    flow: (c) => `Position #${c.pos}'s vector is added on, so the model knows where this token sits.` },
  norm: { color: '#3fd0c0', title: 'Normalization', tag: 'NORM', icon: 'N',
    blurb: 'Rescales the vector so its numbers stay in a healthy range as it passes through dozens of layers.',
    detail: 'Without normalization, values can explode or shrink to nothing after many layers, and training becomes unstable. The norm rescales the vector, then applies a learned per-dimension gain.',
    analogy: 'A volume limiter on a mixing desk: it keeps every channel loud enough to hear but never clipping.',
    flow: (c) => `The vector gets rebalanced. No number is allowed to shout over the rest.` },
  attention: { color: '#29adff', title: 'Attention', tag: 'MIXING', icon: 'A',
    blurb: 'Lets the current token look back at earlier tokens and pull in whatever context it needs.',
    detail: 'Each token makes a Query ("what am I looking for?"). Earlier tokens offer Keys ("what I contain") and Values ("what I will hand over"). Query-key match scores become weights, and the token takes a weighted mix of the values. Several heads do this in parallel, each looking for different patterns.',
    analogy: 'A group chat where you skim everyone\'s earlier messages and quote the ones that matter right now.',
    flow: (c) => `Query meets ${c.cache} cached keys. It blends in their values, then stores its own K and V in the KV cache.` },
  add: { color: '#ffec27', title: 'Residual Add', tag: 'SKIP', icon: '+',
    blurb: 'Adds the input that skipped around the block back onto the block\'s output.',
    detail: 'Residual connections give information (and training gradients) a highway that bypasses each sub-layer. Every block only has to learn a small change to the vector, not rebuild it from scratch. This is what makes 60+ layer models trainable.',
    analogy: 'Editing a document with tracked changes: you keep the original and add edits on top.',
    flow: () => `The bypass copy (gold) rejoins here. Output = input + what the block just learned.` },
  ffn: { color: '#00e436', title: 'Feed-Forward', tag: 'MLP', icon: 'F',
    blurb: 'A small neural network applied to each token on its own: expand, squish through a nonlinearity, shrink back.',
    detail: 'The vector is projected up to a much wider hidden size, passed through an activation (GELU, or a gated variant like SwiGLU), and projected back down. Most of the parameters, and much of the model\'s stored "knowledge", live in these layers.',
    analogy: 'A big kitchen behind the counter: each order (token) gets the full treatment privately, no chatting with other orders.',
    flow: (c) => `The vector inflates to ${num(c.hidden)} numbers, gets squished, then shrinks back to ${num(c.d)}.` },
  moe: { color: '#ff77a8', title: 'Mixture of Experts', tag: 'ROUTING', icon: 'M',
    blurb: 'A router sends each token to just a few specialist feed-forward networks ("experts") out of many.',
    detail: 'Instead of one big FFN, there are many smaller ones. A small router network scores every expert for this token and only the top-k run. The model can hold huge total knowledge while each token only pays for a few experts.',
    analogy: 'A hospital triage desk: you see 2 or 3 relevant specialists, not every doctor in the building.',
    flow: (c) => `The router picks ${c.k} of ${num(c.experts)} experts${c.shared ? ' plus the always-on shared expert' : ''}. Only those run, and their outputs are blended.` },
  lmhead: { color: '#ff004d', title: 'LM Head', tag: 'OUTPUT', icon: 'H',
    blurb: 'Projects the final vector onto every token in the vocabulary, giving each a score (a "logit").',
    detail: 'One big matrix multiply turns the vector into one score per vocabulary entry. Higher scores mean "more likely to be the next token". Some models reuse (tie) the embedding table here.',
    analogy: 'A scoreboard with one light for every word the model knows. The brightest lights are the best guesses.',
    flow: (c) => `${num(c.vocab)} scores light up, one for every token in the vocabulary.` },
  sampler: { color: '#ff6c24', title: 'Sampler', tag: 'PICK', icon: 'S',
    blurb: 'Turns scores into probabilities (softmax) and picks the next token.',
    detail: 'Softmax turns logits into probabilities that sum to 1. Then a token is chosen, either the top one (greedy) or a random draw shaped by temperature and top-p. The chosen token is fed back in as the next input. That loop is "autoregressive" generation.',
    analogy: 'A slot machine with loaded reels: likely tokens take up more of the wheel.',
    flow: (c) => `Reels spin... and out pops ${c.next}! It becomes the next input.` },
  custom: { color: '#c2c3c7', title: 'Component', tag: 'PART', icon: '?',
    blurb: 'A component of this model.', detail: '', analogy: '',
    flow: (c) => `${c.name} processes the vector.` },
};

const DEFAULT_DEMO = { prompt: ['The', ' cat', ' sat', ' on', ' the'], continuation: [' mat', '.', ' It', ' purred', '.'] };

// ---------------------------------------------------------------- boot
async function boot() {
  let THREE;
  try { THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'); }
  catch (e) { $('#loading').textContent = 'Could not load three.js (offline?)'; return; }
  await Promise.all((window.LLM_ARCADE_MANIFEST || []).map((id) => loadScript(`models/${id}.js${VER}`)));
  const order = window.LLM_ARCADE_MANIFEST || [];
  MODELS.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  MODELS.forEach(prepModel);
  try { await document.fonts.ready; } catch (e) { /* ignore */ }
  start(THREE);
  $('#loading').remove();
}

function prepModel(m) {
  const blocks = {}; (m.blocks || []).forEach((b) => (blocks[b.id] = b));
  m.demo = Object.assign({}, DEFAULT_DEMO, m.demo || {});
  m.quiz = m.quiz || [];
  m.sections = [];
  let cur = null, seenBlock = false;
  m.pieces.forEach((p, i) => {
    p.index = i;
    const K = KINDS[p.kind] || KINDS.custom;
    p.K = K; p.color = p.color || K.color; p.title = p.name || K.title;
    if (p.block) seenBlock = true;
    const key = p.block ? 'b:' + p.block : (seenBlock ? 'post' : 'pre');
    if (!cur || cur.key !== key) {
      const block = p.block ? (blocks[p.block] || (blocks[p.block] = { id: p.block, repeat: 1 })) : null;
      cur = { key, block, pieces: [] }; m.sections.push(cur);
    }
    cur.pieces.push(p); p.section = cur;
  });
  m.byId = {}; m.pieces.forEach((p) => (m.byId[p.id] = p));
  m.d = m.d || (m.byId.emb && m.byId.emb.dim) || 768;
  m.vocab = m.vocab || 50000;
}

// ================================================================ app
function start(THREE) {
  const V3 = THREE.Vector3;
  const canvas = $('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  const SKY = '#1a1c3a';
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 70, 160);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
  scene.add(new THREE.HemisphereLight('#ffffff', '#4a3f70', 1.6));
  const sun = new THREE.DirectionalLight('#fff2dc', 2.2); sun.position.set(12, 24, 16); scene.add(sun);

  // Cel-shading ramp: 3 hard bands give the flat pixel-art lighting.
  const ramp = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: ramp }, extra));
  const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
  const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX);
  const EDGE_MAT = new THREE.LineBasicMaterial({ color: '#0b0b1a', transparent: true, opacity: 0.55 }); // softer than pure black, so thin lines don't strobe while orbiting
  const noRay = () => {};

  let PIX = 3; // render resolution divider -> chunky pixels (2 on small screens)
  const PIX_MODES = { chunky: 1, medium: 0.67, fine: 0.4 }; // multiplier on the auto pixel size
  let W = 1, H = 1;
  function resize() {
    W = window.innerWidth; H = window.innerHeight; PIX = Math.max(1, Math.round((W < 1100 ? 2 : 3) * (PIX_MODES[save.pix] || 1)));
    renderer.setSize(Math.ceil(W / PIX), Math.ceil(H / PIX), false);
    camera.aspect = W / H; applyInset();
  }
  // a docked panel (the workshop) can cover part of the screen; shift the 3D view so the model centers in what's left
  let inset = { left: 0, bottom: 0 };
  function applyInset() {
    if (inset.left || inset.bottom) camera.setViewOffset(W, H, -inset.left / 2, inset.bottom / 2, W, H); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function setInset(left, bottom) { inset = { left: Math.max(0, left | 0), bottom: Math.max(0, bottom | 0) }; applyInset(); }
  window.addEventListener('resize', resize); resize();

  function checkerTex(a, b, cells = 2) {
    const c = document.createElement('canvas'); c.width = c.height = cells * 8;
    const g = c.getContext('2d');
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * 8, y * 8, 8, 8); }
    g.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < cells; i++) { g.fillRect(i * 8, 0, 1, c.height); g.fillRect(0, i * 8, c.width, 1); }
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const floorTex = checkerTex('#252a58', '#2b3062'); floorTex.repeat.set(60, 60);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.raycast = noRay; scene.add(floor);
  const ROOM_TEX = checkerTex('#9fe8cf', '#d9f5e6');
  const PAD_TEX = checkerTex('#efe2c9', '#fff6e3');

  // ------------------------------------------------------------ voxel builder
  function builder(group, mats) {
    const mat = (c) => (mats[c] = mats[c] || toon(c));
    const outline = (m, geo) => { const l = new THREE.LineSegments(geo || UNIT_EDGES, EDGE_MAT); l.raycast = noRay; m.add(l); };
    return {
      box(w, h, d, c, x, y, z, parent = group) { const m = new THREE.Mesh(UNIT_BOX, mat(c)); m.scale.set(w, h, d); m.position.set(x, y, z); outline(m); parent.add(m); return m; },
      cyl(rt, rb, h, seg, c, x, y, z, parent = group) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); const m = new THREE.Mesh(g, mat(c)); m.position.set(x, y, z); outline(m, new THREE.EdgesGeometry(g, 20)); parent.add(m); return m; },
      torus(r, t, c, x, y, z, parent = group) { const g = new THREE.TorusGeometry(r, t, 4, 10); const m = new THREE.Mesh(g, mat(c)); m.position.set(x, y, z); m.rotation.x = Math.PI / 2; parent.add(m); return m; },
      group(x = 0, y = 0, z = 0, parent = group) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; },
      mat,
    };
  }
  const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); };

  // Each builder returns { top: height for label, anim(t,dt,active), ...refs }
  const BUILD = {
    tokenizer(b, p) {
      const c = p.color;
      b.box(2.2, 1.2, 1.6, c, 0, 0.6, 0);
      b.box(2.3, 0.2, 1.7, shade(c, 0.6), 0, 1.25, 0);
      const hop = b.cyl(1.0, 0.45, 0.8, 4, '#c2c3c7', 0, 1.75, 0); hop.rotation.y = Math.PI / 4;
      b.box(1.2, 0.18, 0.1, '#0b0b1a', 0, 0.75, 0.81);
      const light = b.box(0.22, 0.22, 0.1, '#ff004d', 0.75, 0.95, 0.82);
      b.box(0.6, 0.35, 0.6, shade(c, 0.75), 1.3, 0.35, 0);
      const blade = b.box(1.0, 0.08, 0.08, '#fff1e8', 0, 1.42, 0);
      return { top: 2.3, anim(t, dt, a) { blade.rotation.y += dt * (a ? 18 : 1.5); light.visible = a ? (t * 10 | 0) % 2 === 0 : (t * 1.5 | 0) % 2 === 0; } };
    },
    embedding(b, p) {
      const c = p.color, dark = shade(c, 0.55);
      b.box(2.4, 0.2, 1.0, dark, 0, 0.1, 0);
      b.box(0.2, 2.4, 1.0, dark, -1.1, 1.2, 0); b.box(0.2, 2.4, 1.0, dark, 1.1, 1.2, 0);
      b.box(2.4, 0.2, 1.0, dark, 0, 2.4, 0); b.box(2.0, 2.2, 0.1, shade(c, 0.4), 0, 1.2, -0.45);
      const cells = []; const pal = ['#29adff', '#ff77a8', '#ffec27', '#00e436', '#ffa300', '#fff1e8', c];
      for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) cells.push(b.box(0.26, 0.38, 0.6, pal[(r * 7 + k * 3) % pal.length], -0.82 + k * 0.33, 0.45 + r * 0.5, 0.05));
      b.box(0.7, 0.3, 0.5, '#fff1e8', 0, 2.65, 0.1).rotation.z = 0.08;
      return { top: 3.0, cells, anim(t, dt, a) { if (a && Math.random() < 0.3) { const x = cells[(Math.random() * cells.length) | 0]; x.position.z = 0.05 + (x.position.z > 0.1 ? 0 : 0.25); } } };
    },
    posenc(b, p) {
      const c = p.color;
      b.box(1.8, 0.9, 1.6, c, 0, 0.45, 0);
      const face = b.cyl(0.7, 0.7, 0.2, 8, '#fff1e8', 0, 1.1, 0);
      const hand = b.box(0.08, 0.1, 0.6, '#0b0b1a', 0, 1.25, -0.2);
      const hg = b.group(0, 1.25, 0); hand.position.set(0, 0, -0.25); hg.add(hand);
      for (let i = 0; i < 4; i++) b.box(0.25, 0.2, 0.08, '#0b0b1a', -0.6 + i * 0.4, 0.45, 0.81);
      return { top: 1.8, anim(t, dt, a) { hg.rotation.y -= dt * (a ? 8 : 0.8); face.rotation.y = 0; } };
    },
    norm(b, p) {
      const c = p.color;
      b.box(2.0, 0.35, 1.5, c, 0, 0.18, 0);
      b.box(2.1, 0.08, 1.6, shade(c, 0.6), 0, 0.38, 0);
      const bars = []; for (let i = 0; i < 6; i++) bars.push(b.box(0.2, 1, 0.2, i % 2 ? '#fff1e8' : '#ffec27', -0.75 + i * 0.3, 0.9, 0));
      const seed = bars.map(() => 0.3 + Math.random() * 1.4);
      return { top: 1.9, anim(t, dt, a, f) { bars.forEach((bar, i) => { const wild = seed[i] * (1 + 0.3 * Math.sin(t * 3 + i)); const h = a ? 0.8 + (wild - 0.8) * Math.max(0, 1 - f * 2) : wild; bar.scale.y = h; bar.position.y = 0.42 + h / 2; }); } };
    },
    attention(b, p) {
      const c = p.color, v = p.variant || 'mha';
      b.box(2.4, 1.8, 1.8, c, 0, 0.9, 0);
      b.box(2.5, 0.18, 1.9, shade(c, 0.6), 0, 1.86, 0);
      const nQ = Math.min(p.heads || 8, 16), cols = Math.min(nQ, 8), rows = Math.ceil(nQ / cols);
      const wins = [];
      for (let i = 0; i < nQ; i++) { const r = (i / cols) | 0, k = i % cols; wins.push(b.box(0.18, 0.26, 0.08, '#ffec27', -0.85 + k * (1.7 / Math.max(1, cols - 1)), 1.35 - r * 0.42, 0.91)); }
      const nKV = Math.min(p.kvHeads || p.heads || 8, 8);
      const kvs = [];
      if (v !== 'mla') for (let i = 0; i < nKV; i++) kvs.push(b.box(0.22, 0.35, 0.22, '#ffa300', -0.9 + i * (1.8 / Math.max(1, nKV - 1 || 1)), 2.15, -0.5));
      let funnel = null;
      if (v === 'mla') { funnel = b.cyl(0.75, 0.25, 0.7, 6, '#b06bff', 0.2, 2.3, -0.2); b.box(0.5, 0.3, 0.5, '#ffa300', 0.2, 2.8, -0.2); }
      let band = null;
      if (v === 'sliding' || v === 'alternating') band = b.box(0.55, 1.7, 0.06, '#ff004d', 0, 0.92, 0.96);
      let ring = null; if (p.rope) ring = b.torus(1.55, 0.06, '#ffccaa', 0, 1.0, 0);
      if (p.qkNorm) { b.box(0.5, 0.12, 0.4, '#3fd0c0', -1.4, 0.9, 0.5); b.box(0.5, 0.12, 0.4, '#3fd0c0', -1.4, 1.2, 0.5); }
      if (p.sinks) b.box(0.3, 0.3, 0.3, '#0b0b1a', 1.05, 0.3, 0.92);
      // KV cache rack behind the unit: a systems-design detail worth seeing.
      const rack = b.group(0, 0, -1.7);
      b.box(2.4, 0.12, 0.6, '#5f574f', 0, 0.06, 0, rack); b.box(2.4, 0.12, 0.6, '#5f574f', 0, 0.86, 0, rack);
      b.box(0.1, 0.9, 0.6, '#5f574f', -1.2, 0.45, 0, rack); b.box(0.1, 0.9, 0.6, '#5f574f', 1.2, 0.45, 0, rack);
      const slots = [];
      for (let i = 0; i < 12; i++) { const s = b.box(0.3, 0.28, 0.4, '#fff1e8', -1.0 + (i % 6) * 0.4, 0.3 + ((i / 6) | 0) * 0.32, 0, rack); s.visible = false; slots.push(s); }
      return { top: 2.9, wins, slots, rack, anim(t, dt, a) {
        if (ring) ring.rotation.z += dt * (a ? 4 : 0.5);
        if (band) band.position.x = Math.sin(t * (a ? 4 : 1)) * 0.9;
        if (funnel) funnel.rotation.y += dt * (a ? 6 : 0.4);
        wins.forEach((w, i) => (w.visible = a ? ((t * 8 + i) | 0) % 3 !== 0 : true));
        kvs.forEach((k, i) => (k.position.y = 2.15 + (a ? Math.abs(Math.sin(t * 6 + i)) * 0.15 : 0)));
      } };
    },
    add(b, p) {
      const c = p.color;
      b.cyl(0.6, 0.7, 0.5, 8, c, 0, 0.25, 0);
      const g = b.group(0, 0.75, 0);
      b.box(0.7, 0.18, 0.18, '#fff1e8', 0, 0, 0, g); b.box(0.18, 0.7, 0.18, '#fff1e8', 0, 0, 0, g);
      return { top: 1.4, anim(t, dt, a) { g.rotation.y += dt * (a ? 8 : 1); g.position.y = 0.75 + Math.sin(t * 2) * 0.06; } };
    },
    ffn(b, p) {
      const c = p.color;
      b.box(2.6, 1.4, 1.6, c, 0, 0.7, 0);
      b.box(2.7, 0.18, 1.7, shade(c, 0.6), 0, 1.45, 0);
      for (let i = 0; i < 5; i++) b.box(0.12, 0.8, 0.06, shade(c, 0.45), -0.9 + i * 0.25, 0.7, 0.81);
      b.cyl(0.55, 0.55, 0.12, 8, '#5f574f', 0.6, 1.6, 0);
      const fan = b.group(0.6, 1.72, 0);
      b.box(1.0, 0.06, 0.18, '#fff1e8', 0, 0, 0, fan); b.box(0.18, 0.06, 1.0, '#fff1e8', 0, 0, 0, fan);
      if (/glu/i.test(p.variant || '')) { b.cyl(0.18, 0.18, 0.9, 6, '#ffec27', -1.55, 0.5, 0.35).rotation.z = Math.PI / 2; b.cyl(0.18, 0.18, 0.9, 6, '#29adff', -1.55, 0.5, -0.35).rotation.z = Math.PI / 2; }
      return { top: 2.1, anim(t, dt, a) { fan.rotation.y += dt * (a ? 22 : 2); } };
    },
    moe(b, p) {
      const c = p.color, n = Math.min(p.experts || 8, 16), cols = n > 8 ? 4 : Math.min(n, 4), rows = Math.ceil(n / cols);
      b.box(3.4, 0.2, 3.0, '#5f574f', 0, 0.1, -0.3);
      const router = b.group(-1.3, 0, 0.9);
      b.box(0.9, 0.9, 0.8, '#ffec27', 0, 0.65, 0, router); b.box(0.06, 0.6, 0.06, '#0b0b1a', 0.25, 1.4, 0, router);
      const tip = b.box(0.16, 0.16, 0.16, '#ff004d', 0.25, 1.75, 0, router);
      const cabs = [];
      for (let i = 0; i < n; i++) {
        const r = (i / cols) | 0, k = i % cols;
        const g = b.group(-0.2 + k * 0.62, 0.2, 0.6 - r * 0.62);
        b.box(0.46, 0.8, 0.46, c, 0, 0.4, 0, g);
        const lamp = b.box(0.2, 0.12, 0.06, '#5f574f', 0, 0.6, 0.24, g);
        cabs.push({ g, lamp });
      }
      let shared = null;
      if (p.shared) { shared = b.group(-1.3, 0.2, -0.7); b.box(0.75, 1.2, 0.75, '#ffa300', 0, 0.6, 0, shared); b.box(0.3, 0.14, 0.06, '#ffec27', 0, 0.95, 0.39, shared); }
      return { top: 2.6, cabs, router, shared, rows, anim(t, dt, a) { tip.visible = a ? (t * 12 | 0) % 2 === 0 : true; } };
    },
    lmhead(b, p) {
      const c = p.color;
      b.box(2.8, 0.5, 1.4, c, 0, 0.25, 0);
      b.box(2.9, 0.12, 1.5, shade(c, 0.55), 0, 0.56, 0);
      const bars = []; const pal = ['#fff1e8', '#ffec27', '#29adff', '#00e436'];
      for (let i = 0; i < 9; i++) bars.push(b.box(0.2, 1, 0.2, pal[i % 4], -1.1 + i * 0.275, 1.1, 0));
      const base = bars.map(() => 0.2 + Math.random() * 0.6);
      return { top: 2.4, anim(t, dt, a) { bars.forEach((bar, i) => { const h = a ? 0.2 + Math.abs(Math.sin(t * 7 + i * 1.7)) * 1.5 : base[i] + 0.1 * Math.sin(t + i); bar.scale.y = h; bar.position.y = 0.62 + h / 2; }); } };
    },
    sampler(b, p) {
      const c = p.color;
      b.box(1.8, 1.8, 1.3, c, 0, 0.9, 0);
      b.box(1.9, 0.25, 1.4, shade(c, 0.6), 0, 1.9, 0);
      const reels = []; for (let i = 0; i < 3; i++) { const r = b.group(-0.5 + i * 0.5, 1.1, 0.62); b.box(0.36, 0.5, 0.14, '#fff1e8', 0, 0, 0, r); b.box(0.18, 0.18, 0.16, ['#ff004d', '#ffec27', '#29adff'][i], 0, 0, 0.02, r); reels.push(r); }
      b.cyl(0.07, 0.07, 1.0, 6, '#c2c3c7', 1.05, 1.3, 0);
      const knob = b.box(0.28, 0.28, 0.28, '#ff004d', 1.05, 1.85, 0);
      b.box(0.8, 0.3, 0.2, '#0b0b1a', 0, 0.4, 0.66);
      return { top: 2.5, anim(t, dt, a) { reels.forEach((r, i) => (r.rotation.x += dt * (a ? 14 + i * 4 : 0))); knob.position.y = a ? 1.5 : 1.85; } };
    },
    custom(b, p) {
      const c = p.color;
      b.box(2.0, 1.4, 1.6, c, 0, 0.7, 0);
      b.box(2.1, 0.16, 1.7, shade(c, 0.6), 0, 1.45, 0);
      const gem = b.box(0.4, 0.4, 0.4, '#fff1e8', 0, 1.9, 0);
      return { top: 2.4, anim(t, dt, a) { gem.rotation.y += dt * (a ? 6 : 1); } };
    },
  };

  // ------------------------------------------------------------ pooled segments (pipes, arcs)
  function makePool(color, thick) {
    const mat = toon(color);
    const items = []; let n = 0;
    return {
      begin() { n = 0; },
      seg(a, b, parent) {
        const len = a.distanceTo(b); if (len < 1e-3) return;
        let m = items[n];
        if (!m) { m = new THREE.Mesh(UNIT_BOX, mat); const l = new THREE.LineSegments(UNIT_EDGES, EDGE_MAT); l.raycast = noRay; m.add(l); m.raycast = noRay; items.push(m); }
        if (m.parent !== parent) parent.add(m);
        m.visible = true; m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.set(thick, thick, len + thick); m.lookAt(b); n++;
      },
      path(pts, parent) { for (let i = 0; i < pts.length - 1; i++) this.seg(pts[i], pts[i + 1], parent); },
      end() { for (let i = n; i < items.length; i++) items[i].visible = false; },
      clear() { items.forEach((m) => m.parent && m.parent.remove(m)); items.length = 0; n = 0; },
    };
  }
  const pipes = makePool('#8b8fb8', 0.24), loops = makePool('#5a5480', 0.18), skips = makePool('#ffc23a', 0.14);

  function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; }
  function polyAt(pts, t) {
    const total = polyLen(pts); let d = clamp(t, 0, 1) * total;
    for (let i = 1; i < pts.length; i++) { const s = pts[i].distanceTo(pts[i - 1]); if (d <= s || i === pts.length - 1) return pts[i - 1].clone().lerp(pts[i], s ? clamp(d / s, 0, 1) : 1); d -= s; }
    return pts[pts.length - 1].clone();
  }

  // ------------------------------------------------------------ labels
  const labelLayer = $('#labels');
  function addLabel(cls, html, color) { const d = el('div', 'lbl ' + cls, html); if (color) d.style.setProperty('--c', color); labelLayer.appendChild(d); return d; }
  const tmpV = new V3();
  const ANCHORS = { above: 'translate(-50%, -100%)', left: 'translate(-100%, -50%)', right: 'translate(0, -50%)', below: 'translate(-50%, 0)' };
  function placeLabel(div, v, anchor = 'above') {
    tmpV.copy(v).project(camera);
    if (tmpV.z > 1 || tmpV.z < -1) { div.style.display = 'none'; return; }
    div.style.display = '';
    div.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * W) | 0}px, ${((-tmpV.y * 0.5 + 0.5) * H) | 0}px) ${ANCHORS[anchor]}`;
  }

  // ------------------------------------------------------------ camera rig
  const cam = { target: new V3(), theta: 0.55, phi: 0.95, radius: 40, goal: { target: new V3(), theta: 0.55, phi: 0.95, radius: 40 } };
  function updateCamera(dt) {
    const k = 1 - Math.pow(0.0015, dt);
    cam.target.lerp(cam.goal.target, k);
    cam.theta += (cam.goal.theta - cam.theta) * k; cam.phi += (cam.goal.phi - cam.phi) * k; cam.radius += (cam.goal.radius - cam.radius) * k;
    const sp = Math.sin(cam.phi);
    camera.position.set(cam.target.x + cam.radius * sp * Math.sin(cam.theta), cam.target.y + cam.radius * Math.cos(cam.phi), cam.target.z + cam.radius * sp * Math.cos(cam.theta));
    camera.lookAt(cam.target);
  }
  let camTouched = -99; // last time the player moved the camera by hand; follow cam backs off for a moment
  // move the view like grabbing the floor: the ground under the pointer stays under the pointer
  function panBy(dx, dy) {
    const upp = (2 * cam.radius * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(H, 1);
    const vf = Math.min(1 / Math.max(Math.cos(cam.phi), 0.01), 3); // the tilted floor is foreshortened vertically
    const fwd = new V3(-Math.sin(cam.theta), 0, -Math.cos(cam.theta)), right = new V3(Math.cos(cam.theta), 0, -Math.sin(cam.theta));
    const d = right.multiplyScalar(-dx * upp).addScaledVector(fwd, dy * upp * vf);
    for (const t of [cam.goal.target, cam.target]) {
      t.add(d);
      if (world && world.bounds) { const b = world.bounds; t.x = clamp(t.x, b.min.x, b.max.x); t.z = clamp(t.z, b.min.z, b.max.z); }
    }
    camTouched = T;
  }
  function orbitBy(dx, dy) { cam.goal.theta -= dx * 0.008; cam.goal.phi = clamp(cam.goal.phi - dy * 0.006, 0.2, 1.45); camTouched = T; }

  // ------------------------------------------------------------ world
  let world = null;
  const S = 4.2, D = 10; // spacing between pieces / rows

  function clearWorld() {
    if (!world) return;
    stopFlow(true); grind = null; emb = null; att = null; document.body.classList.remove('demo');
    scene.remove(world.root);
    world.root.traverse((o) => { if (o.geometry && o.geometry !== UNIT_BOX && o.geometry !== UNIT_EDGES) o.geometry.dispose(); });
    [pipes, loops, skips].forEach((p) => p.clear());
    labelLayer.innerHTML = '';
    world = null;
  }

  const stackedText = (rep) => (rep > 1 ? `same block, stacked ${num(rep)} times` : 'runs just once (not stacked)');
  function buildWorld(m, opts = {}) {
    clearWorld();
    const root = new THREE.Group(); scene.add(root);
    world = { m, root, pieces: [], byId: {}, rooms: [], selected: null, hovered: null, dirty: true };
    const R = m.sections.length;
    m.sections.forEach((sec, r) => {
      const n = sec.pieces.length, z = ((R - 1) / 2 - r) * D;
      sec.row = r;
      sec.pieces.forEach((p, i) => {
        let x = (i - (n - 1) / 2) * S; if (r % 2) x = -x;
        const g = new THREE.Group(); const mats = {};
        const B = (BUILD[p.kind] || BUILD.custom)(builder(g, mats), p);
        g.position.set(x, 0, z); g.userData.pieceId = p.id; root.add(g);
        const label = addLabel('piece' + (mstate(m.id).seen.includes(p.id) ? ' seen' : ''), esc(p.title), p.color);
        label.style.pointerEvents = 'auto';
        label.addEventListener('click', () => onPieceClick(world.byId[p.id]));
        const obj = { p, g, B, mats, home: new V3(x, 0, z), target: new V3(x, 0, z), flash: 0, active: 0, activeT: 0, label };
        world.pieces.push(obj); world.byId[p.id] = obj;
      });
      // floor pad + walls per section
      const tex = (sec.block ? ROOM_TEX : PAD_TEX).clone(); tex.needsUpdate = true;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: tex }));
      pad.rotation.x = -Math.PI / 2; pad.raycast = noRay; root.add(pad);
      const room = { sec, pad, tex, walls: [] };
      if (sec.block) {
        const wm = toon('#83769c');
        for (let i = 0; i < 4; i++) { const w = new THREE.Mesh(UNIT_BOX, wm); const l = new THREE.LineSegments(UNIT_EDGES, EDGE_MAT); l.raycast = noRay; w.add(l); w.raycast = noRay; root.add(w); room.walls.push(w); }
        const rep = sec.block.repeat || 1;
        room.sign = addLabel('sign', `x${num(rep)} ${esc(sec.block.label || 'TRANSFORMER BLOCK')}<small>${stackedText(rep)}</small>`);
      }
      world.rooms.push(room);
    });
    // selection arrow
    const ab = builder(new THREE.Group(), {});
    world.arrow = new THREE.Group();
    const cone = ab.cyl(0.45, 0, 0.7, 4, '#ffec27', 0, 0, 0, world.arrow); cone.rotation.y = Math.PI / 4;
    ab.box(0.3, 0.5, 0.3, '#ffec27', 0, 0.55, 0, world.arrow);
    world.arrow.visible = false; root.add(world.arrow);
    // packet + ghost + beams + minis
    const pb = builder(new THREE.Group(), {});
    world.packet = new THREE.Group(); pb.box(0.55, 0.55, 0.55, '#ffec27', 0, 0, 0, world.packet); world.packet.visible = false; root.add(world.packet);
    world.packetLabel = addLabel('packet', ''); world.packetLabel.style.display = 'none';
    world.ghost = new THREE.Group(); pb.box(0.35, 0.35, 0.35, '#ffc23a', 0, 0, 0, world.ghost); world.ghost.visible = false; root.add(world.ghost);
    world.ghostLabel = addLabel('ghost', 'BYPASS'); world.ghostLabel.style.display = 'none';
    world.minis = []; for (let i = 0; i < 12; i++) { const g = new THREE.Group(); pb.box(0.22, 0.22, 0.22, '#ffec27', 0, 0, 0, g); g.visible = false; root.add(g); world.minis.push(g); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 6), 3));
    world.beams = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: '#ffec27' })); world.beams.raycast = noRay; world.beams.visible = false; world.beams.frustumCulled = false; root.add(world.beams);
    if (opts.keepCam) fitCamera(false, true); else fitCamera(true);
  }

  function fitCamera(snap, keepAngles) {
    const box = new THREE.Box3(); world.pieces.forEach((o) => box.expandByPoint(o.g.position));
    box.expandByScalar(3);
    world.bounds = box.clone().expandByScalar(4); // panning can't lose the map
    const size = box.getSize(new V3()), c = box.getCenter(new V3());
    const fov = (camera.fov * Math.PI) / 180;
    const needW = (size.x * H) / Math.max(1, W - inset.left), needD = (size.z * 1.05 * H) / Math.max(1, H - inset.bottom); // fit the part of the screen the panel leaves free
    cam.goal.target.copy(c).setY(0.8); cam.goal.target.z += size.z * 0.12;
    cam.goal.radius = clamp((Math.max(needW, needD) / (2 * Math.tan(fov / 2))) * 1.0, 14, 140);
    if (!keepAngles) { cam.goal.theta = 0.35; cam.goal.phi = 0.78; }
    if (snap) { cam.target.copy(cam.goal.target); cam.radius = cam.goal.radius * 1.6; cam.theta = cam.goal.theta - 0.9; cam.phi = cam.goal.phi; }
  }

  // ------------------------------------------------------------ routes between pieces
  const PIPE_Y = 0.45;
  const pos = (o) => o.g.position;
  function route(a, b) {
    const A = new V3(pos(a).x, pos(a).y + PIPE_Y, pos(a).z), B = new V3(pos(b).x, pos(b).y + PIPE_Y, pos(b).z);
    if (Math.abs(A.z - B.z) < 0.05 || Math.abs(A.x - B.x) < 0.05) return [A, B];
    return [A, new V3(B.x, A.y, A.z), B];
  }
  function loopRoute(sec) {
    const objs = sec.pieces.map((p) => world.byId[p.id]);
    const first = objs[0], last = objs[objs.length - 1];
    const bz = Math.min(...objs.map((o) => pos(o).z)) - 2.6;
    const L = pos(last), F = pos(first);
    return [new V3(L.x, L.y + PIPE_Y, L.z), new V3(L.x, PIPE_Y, bz), new V3(F.x, PIPE_Y, bz), new V3(F.x, F.y + PIPE_Y, F.z)];
  }
  function skipRoute(addObj, k) {
    const rf = world.byId[addObj.p.residualFrom]; if (!rf) return null;
    const prev = world.pieces[rf.p.index - 1];
    const end = new V3(pos(addObj).x, pos(addObj).y + PIPE_Y + 0.3, pos(addObj).z);
    let branch;
    if (prev) { const r = route(prev, rf); const a = r[r.length - 2], b = r[r.length - 1]; const dir = a.clone().sub(b); const L = dir.length(); branch = b.clone().add(dir.normalize().multiplyScalar(Math.min(1.7, L * 0.5))); }
    else branch = new V3(pos(rf).x - 1.7, PIPE_Y, pos(rf).z);
    const off = 1.9 + (k % 2) * 0.6, hy = 2.9 + (k % 2) * 0.5;
    return [branch, new V3(branch.x, branch.y, branch.z + off), new V3(branch.x, hy, branch.z + off), new V3(end.x, hy, end.z + off), new V3(end.x, end.y, end.z + off), end];
  }
  function inRoute() { const f = world.pieces[0]; const P = pos(f); return [new V3(P.x, PIPE_Y, P.z + 5), new V3(P.x, P.y + PIPE_Y, P.z)]; }

  function rebuildPipes() {
    const r = world.root;
    pipes.begin(); loops.begin(); skips.begin();
    pipes.path(inRoute(), r);
    for (let i = 0; i < world.pieces.length - 1; i++) pipes.path(route(world.pieces[i], world.pieces[i + 1]), r);
    let k = 0;
    world.m.sections.forEach((sec) => { if (sec.block && (sec.block.repeat || 1) > 1) loops.path(loopRoute(sec), r); });
    world.pieces.forEach((o) => { if (o.p.residualFrom) { const sr = skipRoute(o, k++); if (sr) { skips.path(sr, r); o.skipK = k - 1; } } });
    pipes.end(); loops.end(); skips.end();
    // pads & walls
    world.rooms.forEach((room) => {
      const objs = room.sec.pieces.map((p) => world.byId[p.id]);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      objs.forEach((o) => { x0 = Math.min(x0, pos(o).x); x1 = Math.max(x1, pos(o).x); z0 = Math.min(z0, pos(o).z); z1 = Math.max(z1, pos(o).z); });
      x0 -= 2.2; x1 += 2.2; z0 -= room.sec.block ? 3.2 : 1.8; z1 += 1.8;
      const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      room.pad.scale.set(w, d, 1); room.pad.position.set(cx, 0.005, cz);
      room.tex.repeat.set(w / 2, d / 2);
      if (room.walls.length) {
        const h = 0.5, t = 0.3;
        const set = (m, sx, sz, px, pz) => { m.scale.set(sx, h, sz); m.position.set(px, h / 2, pz); };
        set(room.walls[0], w + t, t, cx, z0); set(room.walls[1], w + t, t, cx, z1);
        set(room.walls[2], t, d, x0, cz); set(room.walls[3], t, d, x1, cz);
        room.signPos = new V3(x0 + 0.4, 1.4, z0);
      }
    });
  }

  // ------------------------------------------------------------ selection / inspector
  function pieceFacts(p) {
    const f = (p.facts || []).slice();
    return f;
  }
  function select(o, opts = {}) {
    if (world.selected) world.selected.label.classList.remove('sel');
    world.selected = o;
    if (!o || o.p.kind !== 'tokenizer') stopGrind();
    if (!o || o.p.kind !== 'embedding') stopEmb();
    if (!o || o.p.kind !== 'attention') stopAtt();
    if (!o) { $('#inspector').hidden = true; world.arrow.visible = false; syncSheet(); return; }
    o.label.classList.add('sel'); world.arrow.visible = true;
    if (!opts.silent) sfx.select();
    o.flash = 1;
    const st = mstate(world.m.id);
    if (!st.seen.includes(o.p.id)) {
      st.seen.push(o.p.id); o.label.classList.add('seen');
      gainXP(10, `NEW PIECE: ${o.p.title.toUpperCase()}`);
      if (st.seen.length === world.m.pieces.length) { toast('ALL PIECES INSPECTED!'); gainXP(50); }
      persist();
    }
    renderInspector(o);
    say(o.p, o.p.blurb || o.p.K.blurb);
    if (o.p.kind === 'tokenizer') startGrind(o);
    if (o.p.kind === 'embedding') startEmb(o);
    if (o.p.kind === 'attention') startAtt(o);
  }
  function renderInspector(o) {
    const p = o.p, K = p.K;
    const facts = pieceFacts(p);
    const hasQ = true;
    const box = $('#inspector');
    box.className = 'pbox'; box.hidden = false; box.scrollTop = 0; syncSheet(); box.style.setProperty('--c', p.color);
    box.innerHTML = `
      <div class="insp-head"><div class="ico">${esc(K.icon)}</div>
        <div><div class="kind">${esc(K.tag)}${p.variant ? ' · ' + esc(String(p.variant).toUpperCase()) : ''}</div><h2>${esc(p.title)}</h2></div>
        <button class="pbtn small x" data-a="close" aria-label="Close">X</button></div>
      <p class="blurb">${esc(p.blurb || K.blurb)}</p>
      <h3>HOW IT WORKS</h3><p>${esc(p.detail || K.detail)}</p>
      ${(p.analogy || K.analogy) ? `<div class="analogy"><b>THINK OF IT LIKE...</b>${esc(p.analogy || K.analogy)}</div>` : ''}
      ${facts.length ? `<h3>IN ${esc(world.m.name.toUpperCase())}</h3><table class="facts">${facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
      ${p.special ? `<div class="special"><b>WHAT'S SPECIAL HERE</b>${esc(p.special)}</div>` : ''}
      <div class="insp-actions">
        ${p.kind === 'tokenizer' ? '<button class="pbtn gold" style="grid-column: 1 / -1" data-a="grind">&#9654; REPLAY THE GRINDER</button>' : ''}
        ${p.kind === 'embedding' ? '<button class="pbtn gold" style="grid-column: 1 / -1" data-a="emb">&#9654; REPLAY THE LOOKUP</button>' : ''}
        ${p.kind === 'attention' ? '<button class="pbtn gold" style="grid-column: 1 / -1" data-a="att">&#9654; REPLAY THE SPOTLIGHT</button>' : ''}
        <button class="pbtn gold" data-a="watch">&#9654; WATCH IT</button>
        <button class="pbtn" data-a="quiz" ${hasQ ? '' : 'disabled'}>? QUIZ ME</button>
        <button class="pbtn" style="grid-column: 1 / -1" data-a="focus">ZOOM IN</button>
      </div>`;
    box.onclick = (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) { if (e.target.closest('.insp-head')) { box.classList.toggle('collapsed'); syncSheet(); } return; }
      const act = a.dataset.a;
      if (act === 'close') select(null);
      if (act === 'grind') startGrind(o);
      if (act === 'emb') startEmb(o);
      if (act === 'att') startAtt(o);
      if (act === 'focus') focusOn(o);
      if (act === 'watch') { focusOn(o); keepRunning = false; watchPiece = o; if (!flow) startFlow({ full: true }); else { flow.express = false; flow.paused = false; syncFlowBtn(); } }
      if (act === 'quiz') startQuest(questionsForPiece(o.p), { single: true });
    };
  }
  // on narrow screens the inspector is a bottom sheet; fold it to its header while a demo plays so the 3D stays visible
  // while a piece's demo plays, hide everyone else's labels so the demo reads cleanly
  function setFocus(o) { if (world) world.focus = o || null; document.body.classList.toggle('demo', !!o); }
  function syncSheet() { const i = $('#inspector'); document.body.classList.toggle('sheet', W < 820 && !i.hidden && i.classList.contains('collapsed')); }
  function collapseInspector() { if (W < 820) $('#inspector').classList.add('collapsed'); syncSheet(); }
  function focusOn(o) { cam.goal.target.copy(pos(o)).setY(1); cam.goal.radius = 16; sfx.whoosh(); }

  // ------------------------------------------------------------ tokenizer grinder demo
  // Clicking the tokenizer drops the prompt's words into the hopper and lines up the token IDs that come out.
  let grind = null;
  function grindWords(m, p) {
    if (p.tokenizerDemo) return p.tokenizerDemo; // optional per-model override: [{ "text": " unhappy", "tokens": [" un", "happy"] }, ...]
    const words = m.demo.prompt.map((w) => ({ text: w, tokens: [w] }));
    // finish the prompt's sentence with a compound word, so the split reads naturally: "The cat sat on the windowsill"
    words.push({ text: ' windowsill', tokens: [' window', 'sill'] });
    return words;
  }
  function stopGrind() {
    if (!grind) return;
    grind.items.forEach((it) => { if (it.mesh.parent) it.mesh.parent.remove(it.mesh); it.label.remove(); });
    grind.o.grinding = false; grind.o.g.rotation.z = 0; grind = null; if (!emb && !att) setFocus(null);
  }
  function startGrind(o) {
    stopGrind();
    const m = world.m, words = grindWords(m, o.p), b = builder(o.g, {});
    const total = words.reduce((n, w) => n + w.tokens.length, 0);
    const items = []; let slot = 0;
    words.forEach((w, i) => {
      const t0 = 0.4 + i * 1.0;
      const mesh = b.box(0.14 * w.text.trim().length + 0.3, 0.42, 0.42, '#fff1e8', 0, 4.6, 0); mesh.visible = false;
      const label = addLabel('word', esc(w.text.trim())); label.style.display = 'none';
      items.push({ type: 'word', mesh, label, t0, base: mesh.scale.clone() });
      w.tokens.forEach((tk, k) => {
        const tm = b.box(0.5, 0.5, 0.5, slotColor(tk), 1.3, 0.35, 0); tm.visible = false;
        const tl = addLabel('tokchip', `<b>#${hash(tk) % (m.vocab || 50000)}</b><small>${esc(tk.replace(/^ /, '␣'))}</small>`); tl.style.display = 'none';
        items.push({ type: 'tok', mesh: tm, label: tl, t0: t0 + 0.95 + k * 0.3, slot: slot++, total });
      });
    });
    grind = { o, items, t: 0 }; setFocus(o);
    // frame hopper, falling words and the token row; on narrow screens the inspector sheet covers the bottom, so aim lower
    const narrow = W < 820; collapseInspector();
    cam.goal.target.copy(pos(o)).setY(narrow ? 0.5 : 1.6); cam.goal.target.z += narrow ? 3.2 : 1.2;
    cam.goal.radius = narrow ? 24 : 18; cam.goal.phi = 0.9; cam.goal.theta = 0.25;
    const split = words.find((w) => w.tokens.length > 1);
    const splitMsg = split ? ` Watch "${split.text.trim()}": it comes out as ${split.tokens.length} tokens (${split.tokens.map((t) => t.replace(/^ /, '\u2423')).join(' + ')}), because rarer words get built from common pieces.` : '';
    setTimeout(() => grind && grind.o === o && say(o.p, `"${words.map((w) => w.text).join('').trim()}" goes into the hopper one word at a time, the blades chop it, and token IDs roll out the side.${splitMsg} (\u2423 means the token starts with a space. IDs and splits are illustrative; real ones depend on each model's vocabulary.)`), 50);
  }
  function updateGrind(dt) {
    if (!grind) return;
    grind.t += dt;
    const o = grind.o; let grinding = false;
    grind.items.forEach((it) => {
      const lt = grind.t - it.t0, m = it.mesh;
      if (lt < 0) return;
      if (it.type === 'word') {
        if (lt < 0.6) { const k = lt / 0.6; m.visible = true; m.position.set(0, 4.6 - 2.7 * k * k, 0); m.rotation.y = Math.sin(lt * 9) * 0.25; }
        else if (lt < 0.95) {
          const k = (lt - 0.6) / 0.35; grinding = true;
          m.position.set((Math.random() - 0.5) * 0.12, 1.9 - 0.7 * k, 0); m.scale.copy(it.base).multiplyScalar(Math.max(0.01, 1 - k));
          if (!it.crunched) { it.crunched = true; sfx.grind(); }
        } else { m.visible = false; it.label.style.display = 'none'; return; }
        placeLabel(it.label, o.g.localToWorld(m.position.clone().add(new V3(0, 0.4, 0))));
      } else {
        m.visible = true;
        const out = new V3(1.95, 0.3, 0.6), dest = new V3((it.slot - (it.total - 1) / 2) * 1.25, 0.3, 2.4);
        if (lt < 0.3) { m.position.set(1.3, 0.35, 0).lerp(out, lt / 0.3); if (!it.popped) { it.popped = true; sfx.plink(); } }
        else if (lt < 1.1) { const k = (lt - 0.3) / 0.8; m.position.copy(out).lerp(dest, k); m.position.y = 0.3 + Math.sin(k * Math.PI) * 1.0; }
        else m.position.copy(dest);
        m.rotation.y = lt < 1.1 ? lt * 8 : 0;
        if (lt > 0.3) placeLabel(it.label, o.g.localToWorld(m.position.clone().add(new V3(0, it.slot % 2 ? 1.25 : 0.45, 0))));
      }
    });
    o.grinding = grinding;
    o.g.rotation.z = grinding ? (Math.random() - 0.5) * 0.06 : 0;
  }

  // ------------------------------------------------------------ embedding lookup demo
  // Clicking the embedding piece shows the table as what it is: a matrix (vocab rows x d columns), floating as a wall.
  // Each token flies up, the table scrolls like a slot reel to row #ID, the row is copied out and flies across to a
  // second wall, the sentence matrix [tokens x d]. Cells stick out in 3D by the size of their value.
  let emb = null;
  const EMB_COLS = 16, EMB_ROWS = 11, EMB_HEAD = 5, CELL = 0.32, WALL_Z = -0.7;
  const EMB_PAL = ['#1d4fb8', '#29adff', '#a8dcff', '#3b3f72', '#ffc2d6', '#ff77a8', '#ff004d']; // blue = negative, pink = positive
  const embVal = (row, col) => (hash(row + ':' + col) % 2001) / 1000 - 1;
  const embColor = (v) => EMB_PAL[Math.round(((v + 1) / 2) * 6)];
  function stopEmb() {
    if (!emb) return;
    emb.o.g.remove(emb.root); emb.labels.forEach((l) => l.remove());
    emb.o.active = 0; emb = null; if (!grind && !att) setFocus(null);
  }
  function startEmb(o) {
    stopEmb();
    const m = world.m, V = m.vocab || 50000;
    const tokP = m.pieces.find((p) => p.kind === 'tokenizer');
    const toks = (tokP ? grindWords(m, tokP) : m.demo.prompt.map((w) => ({ text: w, tokens: [w] }))).flatMap((w) => w.tokens);
    const n = toks.length;
    const root = new THREE.Group(); o.g.add(root);
    const b = builder(root, {});
    const labels = [];
    const L = (cls, html, color) => { const d = addLabel(cls, html, color); d.style.display = 'none'; labels.push(d); return d; };
    const W_TBL = -2.7, W_SEN = 3.1;                                      // wall centers (x)
    const tX = (c) => W_TBL + (c - (EMB_COLS - 1) / 2) * CELL, sX = (c) => W_SEN + (c - (EMB_COLS - 1) / 2) * CELL;
    const tY = (r) => 3.4 + (EMB_ROWS - 1 - r) * CELL;                    // table row r (0 = top)
    const headY = tY(EMB_HEAD), sY = (k) => headY + ((n - 1) / 2 - k) * CELL; // sentence row k, centered on the read head
    const panel = (cx, cy, rows) => b.box(EMB_COLS * CELL + 0.3, rows * CELL + 0.3, 0.1, '#0b0b1a', cx, cy, WALL_Z - 0.1);
    panel(W_TBL, tY((EMB_ROWS - 1) / 2), EMB_ROWS); panel(W_SEN, headY, n);
    // arrow between the walls
    b.box(0.5, 0.08, 0.08, '#ffec27', (W_TBL + W_SEN) / 2 - 0.05, headY, WALL_Z); b.cyl(0.14, 0, 0.25, 4, '#ffec27', (W_TBL + W_SEN) / 2 + 0.3, headY, WALL_Z).rotation.z = -Math.PI / 2;
    const cells = [];
    for (let r = 0; r < EMB_ROWS; r++) for (let c = 0; c < EMB_COLS; c++) {
      const mt = toon('#3b3f72'), mesh = new THREE.Mesh(UNIT_BOX, mt);
      mesh.scale.set(CELL * 0.86, CELL * 0.86, 0.12); mesh.position.set(tX(c), tY(r), WALL_Z); mesh.raycast = noRay; root.add(mesh);
      cells.push({ mt, r, c });
    }
    for (let k = 0; k < n; k++) for (let c = 0; c < EMB_COLS; c++) { const mesh = new THREE.Mesh(UNIT_BOX, toon('#262a55')); mesh.scale.set(CELL * 0.86, CELL * 0.86, 0.05); mesh.position.set(sX(c), sY(k), WALL_Z - 0.03); mesh.raycast = noRay; root.add(mesh); } // empty slots
    const hw = EMB_COLS * CELL + 0.14, head = b.group(W_TBL, headY, WALL_Z + 0.1);
    b.box(hw, 0.06, 0.08, '#ffec27', 0, CELL / 2 + 0.03, 0, head); b.box(hw, 0.06, 0.08, '#ffec27', 0, -CELL / 2 - 0.03, 0, head);
    b.box(0.06, CELL + 0.12, 0.08, '#ffec27', -hw / 2, 0, 0, head); b.box(0.06, CELL + 0.12, 0.08, '#ffec27', hw / 2, 0, 0, head);
    const jobs = toks.map((tk, k) => {
      const id = hash(tk) % V, color = slotColor(tk);
      const tcube = b.box(0.36, 0.36, 0.36, color, -5, 0.3, 0.6); tcube.visible = false;
      const tl = L('rowhdr', `${esc(tk.replace(/^ /, '␣'))} <b>#${id}</b>`, color);
      const row = [];
      for (let c = 0; c < EMB_COLS; c++) { const v = embVal(id, c), mesh = new THREE.Mesh(UNIT_BOX, toon(embColor(v))); mesh.raycast = noRay; mesh.visible = false; root.add(mesh); row.push({ mesh, v }); }
      return { tk, id, k, T0: 1.0 + k * 2.8, tcube, tl, row };
    });
    emb = { o, root, cells, labels, jobs, head, t: 0, rowBase: 1000 + (hash(m.id) % 5000), tX, sX, tY, sY, headY, W_TBL, W_SEN, flash: 0, n, landed: 0, done: false,
      title: L('sign', `EMBEDDING TABLE<small>${num(V)} rows (one per token) x ${num(m.d)} numbers</small>`),
      outLbl: L('sign', ''), rowLbl: L('rowhdr', '#0', '#ffec27') };
    emb.from = emb.rowBase; setFocus(o);
    paintWall();
    const narrow = W < 820;
    cam.goal.target.copy(o.g.localToWorld(new V3(narrow ? 0.4 : 2.2, narrow ? 3.0 : 4.2, 0))); cam.goal.radius = narrow ? 26 : 21; cam.goal.phi = 1.2; cam.goal.theta = 0.1;
    collapseInspector();
    setTimeout(() => emb && emb.o === o && say(o.p, `The embedding table is one giant matrix: a row for each of the ${num(V)} tokens, ${num(m.d)} numbers across. A token ID is just a row number, so the lookup scrolls to that row and copies it out. Stack the copies and your sentence becomes a ${n} x ${num(m.d)} matrix, which is what every later layer works on. (Blue = negative, pink = positive, and bigger numbers stick out further. Real values are learned in training; these are illustrative.)`), 50);
  }
  function paintWall() {
    const base = Math.floor(emb.rowBase), V = world.m.vocab || 50000;
    emb.cells.forEach((cl) => cl.mt.color.set(embColor(embVal((((base + cl.r - EMB_HEAD) % V) + V) % V, cl.c))));
  }
  function updateEmb(dt) {
    if (!emb) return;
    emb.t += dt;
    const o = emb.o, e3 = (k) => 1 - Math.pow(1 - k, 3), d = world.m.d;
    let scrolling = false, landed = 0;
    emb.jobs.forEach((j) => {
      const lt = emb.t - j.T0; if (lt < 0) return;
      const tokAtTable = new V3(emb.tX(0) - 0.45, emb.headY, WALL_Z + 0.2), tokAtRow = new V3(emb.sX(EMB_COLS - 1) + 0.45, emb.sY(j.k), WALL_Z + 0.2);
      // 1. the token flies up from the tokenizer side to the table's read head
      j.tcube.visible = true;
      if (lt < 0.5) { const k = ease(lt / 0.5); j.tcube.position.set(-5, 0.3, 0.6).lerp(tokAtTable, k); j.tcube.position.y += Math.sin(k * Math.PI) * 1.0; }
      else if (lt < 1.6) j.tcube.position.copy(tokAtTable);
      // 2. the table scrolls (slot-reel style) until row #id sits under the gold read head
      const s0 = 0.45, s1 = 1.5;
      if (lt >= s0 && lt < s1) { if (!j.started) { j.started = true; emb.from = emb.rowBase; } emb.rowBase = emb.from + (j.id - emb.from) * e3((lt - s0) / (s1 - s0)); scrolling = true; }
      if (lt >= s1 && !j.locked) { j.locked = true; emb.rowBase = j.id; paintWall(); sfx.plink(); emb.flash = 0.45; }
      // 3. the row is copied out and flies across to its slot in the sentence matrix; cells stick out by |value|
      const f0 = 1.6, f1 = 2.6;
      if (lt >= f0) {
        const kt = ease(clamp((lt - f0) / (f1 - f0), 0, 1));
        j.tcube.position.copy(tokAtTable).lerp(tokAtRow, kt); j.tcube.position.z += Math.sin(kt * Math.PI) * 1.2;
        j.row.forEach((cell, c) => {
          const k = ease(clamp((lt - f0 - c * 0.02) / (f1 - f0 - 0.32), 0, 1));
          const depth = 0.1 + Math.abs(cell.v) * 0.7;
          const from = new V3(emb.tX(c), emb.headY, WALL_Z + 0.08), to = new V3(emb.sX(c), emb.sY(j.k), WALL_Z + depth / 2 - 0.06);
          cell.mesh.visible = true;
          cell.mesh.position.lerpVectors(from, to, k); cell.mesh.position.z += Math.sin(k * Math.PI) * 1.4;
          cell.mesh.scale.set(CELL * 0.86, CELL * 0.86, 0.12 + (depth - 0.12) * k);
        });
        if (lt >= f1 && !j.landed) { j.landed = true; sfx.tick(); }
      }
      if (lt >= 0.2) placeLabel(j.tl, o.g.localToWorld(j.tcube.position.clone().add(new V3(0.25, 0, 0))), 'right');
      if (j.landed) landed++;
    });
    if (scrolling) { paintWall(); if (Math.random() < 0.35) sfx.tick(); }
    o.active = scrolling ? 1 : 0;
    if (emb.flash > 0) { emb.flash -= dt; emb.head.visible = ((emb.flash * 12) | 0) % 2 === 0; } else emb.head.visible = true;
    emb.rowLbl.innerHTML = 'ROW #' + num(Math.floor(emb.rowBase));
    placeLabel(emb.rowLbl, o.g.localToWorld(new V3(emb.tX(0) - 0.75, emb.headY, WALL_Z)), 'left');
    placeLabel(emb.title, o.g.localToWorld(new V3(emb.W_TBL, emb.tY(0) + 0.35, WALL_Z)));
    if (landed !== emb.landed || !emb.outLbl.innerHTML) {
      emb.landed = landed;
      emb.outLbl.innerHTML = `YOUR SENTENCE: ${landed} x ${num(d)}<small>${landed === emb.n ? 'one row per token: this matrix goes into layer 1' : 'filling up, one row per token'}</small>`;
    }
    placeLabel(emb.outLbl, o.g.localToWorld(new V3(emb.W_SEN, emb.sY(0) + 0.35, WALL_Z)));
    if (landed === emb.n && !emb.done) { emb.done = true; sfx.pop(); toast(`SENTENCE MATRIX: ${emb.n} x ${num(d)}`); }
  }

  // ------------------------------------------------------------ attention demo ("the spotlight stage")
  // Clicking an attention unit puts the demo sentence on a stage in front of it and walks through one head step by
  // step (Q/K/V -> scores -> softmax -> blend of values), then shows several heads as a 3D heatmap and merges them.
  // Paced like RUN: STEP waits for NEXT between stages, AUTO holds each stage for its reading time.
  let att = null;
  const HEAD_COLORS = ['#ffec27', '#ff77a8', '#29adff', '#b06bff']; // none orange or green, so they never look like a K or V gem
  const ATT_DUR = [1.4, 1.4, 2.4, 1.4, 1.8, 2.6, 2.4, 2.2]; // stage, QKV, scores, softmax, blend, heads, K/V sharing, combine
  function showNext(on) { $('#dlg-next').hidden = !on; $('#dialog').classList.toggle('waiting', on); }
  function stopAtt() {
    if (!att) return;
    att.o.g.remove(att.root); att.labels.forEach((l) => l.remove());
    att.o.active = 0; att = null; showNext(false);
    if (!grind && !emb) setFocus(null);
  }
  function startAtt(o) {
    stopAtt();
    if (flow) stopFlow();
    const m = world.m, p = o.p;
    const tokP = m.pieces.find((x) => x.kind === 'tokenizer');
    const toks = (tokP ? grindWords(m, tokP) : m.demo.prompt.map((w) => ({ text: w, tokens: [w] }))).flatMap((w) => w.tokens);
    const n = toks.length, qi = n - 1;
    const root = new THREE.Group(); o.g.add(root);
    const b = builder(root, {});
    const labels = [];
    const L = (cls, html, color) => { const d = addLabel(cls, html, color); d.style.display = 'none'; labels.push(d); return d; };
    const SP = 0.95, TZ = 2.7;
    const tx = (i) => (i - (n - 1) / 2) * SP, rowZ = (h) => 5.0 + h * 0.8;
    const sliding = p.variant === 'sliding' || p.variant === 'alternating';
    const win = sliding ? Math.min(n, Math.max(2, p.windowShow || 3)) : n;
    const visible = (i) => i > qi - win;
    const nH = Math.min(4, p.heads || 8);
    const roles = [
      { name: 'the previous word', tag: 'prev word', peak: qi - 1 },
      { name: 'who is doing it (the subject)', tag: 'subject', peak: Math.min(1, qi) },
      { name: 'where (the location word)', tag: 'location', peak: Math.min(3, qi) },
      { name: 'the first token, a "resting spot"', tag: 'resting spot', peak: 0 },
    ].slice(0, nH);
    const heads = roles.map((r, h) => {
      const logits = toks.map((_, i) => (i === r.peak ? 3.2 : 0) + ((hash(h + ':' + i) % 100) / 100) * 1.1 + (i === qi ? 0.3 : 0));
      const ex = logits.map((l, i) => (visible(i) ? Math.exp(l) : 0)), sum = ex.reduce((a, c) => a + c, 0);
      const w = ex.map((e) => e / sum);
      const best = w.indexOf(Math.max(...w));
      const lo = Math.min(...logits.filter((_, i) => visible(i))), hi = Math.max(...logits.filter((_, i) => visible(i)));
      return { ...r, logits, w, best, blocked: !visible(r.peak), color: HEAD_COLORS[h], sc: logits.map((l) => 0.08 + ((l - lo) / (hi - lo || 1)) * 1.4) };
    });
    // the stage: tokens with their K (orange) and V (green) gems, plus the query (yellow) over the newest token
    const kMat = toon('#ffa300'); // keys get their own material: the builder shares materials by colour, and an orange token cube must not recolour with them
    const toksM = toks.map((tk, i) => {
      const masked = !visible(i);
      const cube = b.box(0.44, 0.44, 0.44, masked ? '#5f574f' : slotColor(tk), tx(i), 0.22, TZ); cube.visible = false;
      const k = b.box(0.24, 0.24, 0.24, masked ? '#5f574f' : '#ffa300', tx(i), 0.8, TZ); k.rotation.set(Math.PI / 4, 0, Math.PI / 4); k.visible = false; if (!masked) k.material = kMat;
      const v = b.box(0.24, 0.24, 0.24, masked ? '#5f574f' : '#00e436', tx(i), 1.15, TZ); v.rotation.set(Math.PI / 4, 0, Math.PI / 4); v.visible = false;
      const lbl = L('rowhdr', esc(tk.replace(/^ /, '␣')), masked ? '#5f574f' : slotColor(tk));
      const beam = new THREE.Mesh(UNIT_BOX, toon(HEAD_COLORS[0])); beam.raycast = noRay; beam.visible = false; root.add(beam);
      const vc = new THREE.Mesh(UNIT_BOX, toon('#00e436')); vc.raycast = noRay; vc.visible = false; root.add(vc);
      return { tk, masked, cube, k, v, lbl, beam, vc };
    });
    const q = b.box(0.34, 0.34, 0.34, '#ffec27', tx(qi), 1.65, TZ); q.rotation.set(Math.PI / 4, 0, Math.PI / 4); q.visible = false;
    const qLbl = L('rowhdr', 'QUERY', '#ffec27');
    let band = null, bandLbl = null;
    if (sliding && win < n) {
      const x0 = tx(0) - SP / 2, x1 = tx(qi - win) + SP / 2;
      band = new THREE.Mesh(UNIT_BOX, toon('#ff004d', { transparent: true, opacity: 0.35 })); band.raycast = noRay;
      band.scale.set(x1 - x0, 1.5, 0.05); band.position.set((x0 + x1) / 2, 0.75, TZ + 0.4); band.visible = false; root.add(band);
      bandLbl = L('rowhdr', 'OUTSIDE THE WINDOW', '#ff004d');
    }
    // heatmap rows: one row of bars per head
    const rows = heads.map((hd, h) => ({
      bars: toks.map((_, i) => { const mesh = new THREE.Mesh(UNIT_BOX, toon(hd.color)); mesh.raycast = noRay; mesh.visible = false; root.add(mesh); return mesh; }),
      pct: h === 0 ? toks.map(() => L('rowhdr', '', hd.color)) : null,
      name: L('rowhdr', `HEAD ${h + 1} \u00b7 ${esc(hd.tag)}`, hd.color),
      out: (() => { const c = b.box(0.42, 0.42, 0.42, hd.color, tx(qi) + 1.2, 0.3, rowZ(h)); c.visible = false; return c; })(),
    }));
    const merged = b.box(0.5, 0.5, 0.5, '#fff1e8', tx(qi) + 1.2, 0.6, TZ); merged.visible = false;
    const kvK = b.box(0.22, 0.22, 0.22, '#ffa300', 0, 0, 0), kvV = b.box(0.22, 0.22, 0.22, '#00e436', 0, 0, 0); kvK.visible = kvV.visible = false;
    const shareLbl = L('rowhdr', p.kvHeads && p.heads ? `1 K/V SET PER ${Math.round(p.heads / p.kvHeads)} HEADS` : 'SHARED K/V', '#ffa300');
    att = { o, root, labels, shareLbl, toks, toksM, heads, rows, q, qLbl, band, bandLbl, merged, kvK, kvV, n, qi, nH, tx, rowZ, TZ, s: 0, st: 0, waiting: false, advanceReq: false, popped: false,
      gqa: !!(p.kvHeads && p.heads && p.kvHeads < p.heads), sliding, win };
    setFocus(o); collapseInspector();
    const narrow = W < 820;
    cam.goal.target.copy(o.g.localToWorld(new V3(narrow ? 1.2 : 2.0, 0.4, narrow ? 5.8 : 5.2))); cam.goal.radius = narrow ? 21 : 18; cam.goal.phi = 0.92; cam.goal.theta = 0.12;
    setTimeout(() => att && att.o === o && sayAtt(), 50);
  }
  function attText() {
    const a = att, m = world.m, p = a.o.p, h0 = a.heads[0], T = (i) => tokText(a.toks[i]);
    const pct = (hd) => Math.round(hd.w[hd.best] * 100);
    switch (a.s) {
      case 0: return `Attention lets a token look back at the tokens before it. Here's our sentence on stage. The newest token, ${T(a.qi)}, is about to look back to work out what it means here.`;
      case 1: return `Every token makes a Key (orange: "here's what I contain") and a Value (green: "here's what I'll hand over"). The newest token also makes a Query (yellow: "here's what I'm looking for"). Like a library: the query is your search, keys are the labels on the spines, values are the books.${p.variant === 'mla' ? ` In ${m.name}, keys and values are squeezed into a small latent vector before they're stored, so the KV cache stays tiny.` : ''}`;
      case 2: return `Head 1 compares its query with every key (a dot product): the beams and bars show the scores. This head has learned to look for ${h0.name}, so ${T(h0.best)} scores highest.${a.band ? ` Tokens outside the ${num(p.window || 1024)}-token sliding window (red, shrunk for the demo) are blocked, so they get no score at all.` : ''}`;
      case 3: return `Softmax turns the scores into weights that add up to 100%. ${T(h0.best)} gets ${pct(h0)}%, and everything else shares the rest.`;
      case 4: return `Now the token takes a weighted mix of the green values: ${pct(h0)}% of ${T(h0.best)}'s value plus a little of each other one. That blend is head 1's output.`;
      case 5: return `${m.name} runs ${num(p.heads || 8)} heads side by side (showing ${a.nH}). Each has its own query, so each learns to look for something different: ${a.heads.map((hd) => hd.tag).join(', ')}. Together the rows make an attention map.`;
      case 6: {
        const blocked = a.heads.find((hd) => hd.blocked);
        const g = a.gqa ? Math.round(p.heads / p.kvHeads) : 1;
        let t = a.gqa ? `A memory trick (GQA): the ${num(p.heads)} query heads share just ${num(p.kvHeads)} sets of keys and values, one set per group of ${g} heads. Within a group the orange keys stay the same; only the queries differ. That makes the KV cache ${g}x smaller.`
          : p.variant === 'mla' ? `${m.name} saves memory differently (MLA): keys and values are squeezed into a small latent vector before caching, then expanded again for each head.`
          : `In ${m.name}, every head also makes its own keys (watch the orange gems change color for each head). Simple, but the KV cache grows with every head.`;
        if (blocked) t += ` And the ${blocked.tag} head can't reach ${T(blocked.peak)} (outside the window), which is why ${m.name} also has full-attention layers.`;
        return t;
      }
      default: return `Finally the heads' outputs are glued side by side and mixed by one more matrix (the output projection). That's the token's updated vector, carrying context from the words before it. Its own key and value go into the KV cache rack behind the unit, so future tokens can look back at it.`;
    }
  }
  function sayAtt() { att.text = attText(); say(att.o.p, att.text, `${att.o.p.title}  ·  STEP ${att.s + 1} OF ${ATT_DUR.length}`, { cps: narrationCps() }); }
  function updateAtt(dt) {
    if (!att) return;
    const a = att, o = a.o, last = ATT_DUR.length - 1;
    a.st += dt * speed;
    const P = (k) => (a.s > k ? 1 : a.s === k ? clamp(a.st / ATT_DUR[k], 0, 1) : 0);
    // stage pacing (same rules as RUN)
    if (a.s < last && a.st >= ATT_DUR[a.s] && !a.advanceReq) {
      if (runMode === 'step') { if (!a.waiting && !dlg.typing) { a.waiting = true; showNext(true); } }
      else if (!dlg.typing && a.st >= Math.max(ATT_DUR[a.s], readTime(a.text || ''))) a.advanceReq = true;
    }
    if (a.advanceReq) { a.advanceReq = false; a.waiting = false; showNext(false); a.s++; a.st = 0; sfx.tick(); sayAtt(); }
    const p0 = P(0), p1 = P(1), p2 = P(2), p3 = P(3), p4 = P(4), p5 = P(5), p6 = P(6), p7 = P(7);
    const qPos = new V3(a.tx(a.qi), 1.65, a.TZ), h0 = a.heads[0];
    o.active = a.s >= 2 && a.s <= 4 ? 1 : 0;
    a.toksM.forEach((t, i) => {
      // 0: tokens hop onto the stage
      const k0 = clamp(p0 * 1.6 - i * 0.1, 0, 1);
      t.cube.visible = k0 > 0; t.cube.position.set(a.tx(i), 0.22 + Math.sin(k0 * Math.PI) * 0.6, a.TZ);
      if (k0 > 0) placeLabel(t.lbl, o.g.localToWorld(new V3(a.tx(i), -0.05, a.TZ + 0.3)), 'below');
      // 1: K and V gems pop up
      const k1 = clamp(p1 * 1.6 - i * 0.1, 0, 1), sc = Math.sin(k1 * Math.PI / 2);
      t.k.visible = t.v.visible = k1 > 0; t.k.scale.setScalar(0.24 * sc); t.v.scale.setScalar(0.24 * sc);
      t.k.rotation.y = t.v.rotation.y = T * 1.5;
      // 2-4: head 1's beam from the query to each key; thickness follows the softmax weight
      const kPos = new V3(a.tx(i), 0.8, a.TZ);
      const on = !t.masked && p2 > i / a.n && a.s <= 4;
      t.beam.visible = on;
      if (on) {
        const thick = 0.035 + (0.03 + h0.w[i] * 0.2 - 0.035) * p3;
        t.beam.position.copy(qPos).add(kPos).multiplyScalar(0.5); t.beam.scale.set(thick, thick, qPos.distanceTo(kPos)); t.beam.lookAt(o.g.localToWorld(kPos.clone()));
      }
      // 4: values fly to the query, sized by weight, and merge into head 1's output
      const k4 = ease(clamp(p4 * 1.3 - i * 0.04, 0, 1));
      t.vc.visible = !t.masked && p4 > 0 && k4 < 1;
      if (t.vc.visible) { const vs = 0.06 + 0.32 * Math.sqrt(h0.w[i]); t.vc.scale.setScalar(vs); t.vc.position.copy(new V3(a.tx(i), 1.15, a.TZ)).lerp(a.rows[0].out.position, k4); t.vc.position.y += Math.sin(k4 * Math.PI) * 1.2; }
    });
    // K/V sharing stage: MHA cycles the key gems through each head's colour (own keys per head), GQA pulses one shared
    // set, MLA squeezes them (compressed latent)
    if (a.s === 6) {
      const variant = o.p.variant;
      a.toksM.forEach((t) => {
        if (t.masked) return;
        if (a.gqa) { const sc = 0.24 * (1 + 0.25 * Math.abs(Math.sin(T * 5))); t.k.scale.setScalar(sc); t.v.scale.setScalar(sc); }
        else if (variant === 'mla') { const sq = 0.24 * (0.55 + 0.45 * Math.abs(Math.cos(T * 2.5))); t.k.scale.setScalar(sq); t.v.scale.setScalar(sq); }
        else t.k.material.color.set(HEAD_COLORS[Math.floor(p6 * a.nH * 2) % a.nH]);
      });
      if (a.gqa) placeLabel(a.shareLbl, o.g.localToWorld(new V3(a.tx(a.qi - Math.floor(a.n / 2)), 1.55, a.TZ)));
    } else a.shareLbl.style.display = 'none';
    if (a.s === 7) a.toksM.forEach((t) => !t.masked && t.k.material.color.set('#ffa300'));
    a.q.visible = p1 > 0.3; a.q.rotation.y = -T * 2; a.q.position.y = 1.65 + Math.sin(T * 3) * 0.06;
    if (a.q.visible) placeLabel(a.qLbl, o.g.localToWorld(new V3(a.tx(a.qi), 2.0, a.TZ)));
    if (a.band) { a.band.visible = p2 > 0; if (a.band.visible) placeLabel(a.bandLbl, o.g.localToWorld(new V3(a.band.position.x, 1.6, a.TZ + 0.4))); }
    // heatmap rows: head 1 grows with scores (2) then becomes weights (3); heads 2+ rise one by one (5)
    a.rows.forEach((row, h) => {
      const hd = a.heads[h];
      const hp = h === 0 ? p2 : ease(clamp(p5 * (a.nH - 1) - (h - 1), 0, 1));
      row.bars.forEach((bar, i) => {
        const showI = !a.toksM[i].masked && (h === 0 ? p2 > i / a.n : hp > 0);
        bar.visible = showI;
        if (!showI) { if (row.pct) row.pct[i].style.display = 'none'; return; }
        const wH = 0.05 + hd.w[i] * 2.4;
        const hgt = h === 0 ? hd.sc[i] + (wH - hd.sc[i]) * ease(p3) : wH * hp;
        bar.scale.set(0.5, Math.max(0.02, hgt), 0.5); bar.position.set(a.tx(i), hgt / 2, a.rowZ(h));
        if (row.pct) { row.pct[i].innerHTML = p3 > 0.5 ? Math.round(hd.w[i] * 100) + '%' : hd.logits[i].toFixed(1); placeLabel(row.pct[i], o.g.localToWorld(new V3(a.tx(i), hgt + 0.15, a.rowZ(h)))); }
      });
      if (hp > 0) placeLabel(row.name, o.g.localToWorld(new V3(a.tx(a.qi) + 1.6, 0.3, a.rowZ(h))), 'right');
      const outOn = h === 0 ? p4 >= 0.75 : hp >= 1;
      row.out.visible = outOn && p7 < 1;
      if (row.out.visible) {
        const home = new V3(a.tx(a.qi) + 1.2, 0.3, a.rowZ(h)), mergePt = new V3(a.tx(a.qi) + 1.2, 0.6, a.TZ);
        row.out.position.copy(home).lerp(mergePt, ease(clamp(p7 * 2, 0, 1))); row.out.rotation.y = T * 2;
      }
    });
    // 6: outputs merge, fly into the unit; the token's K and V go into the KV cache rack
    const k6 = clamp(p7 * 2 - 1, 0, 1);
    a.merged.visible = p7 >= 0.5 && k6 < 1;
    if (a.merged.visible) { a.merged.position.copy(new V3(a.tx(a.qi) + 1.2, 0.6, a.TZ)).lerp(new V3(0, 1.0, 0.9), ease(k6)); a.merged.position.y += Math.sin(k6 * Math.PI) * 1.4; a.merged.rotation.y = T * 3; }
    a.kvK.visible = a.kvV.visible = p7 > 0.5 && k6 < 1;
    if (a.kvK.visible) {
      a.kvK.position.copy(new V3(a.tx(a.qi), 0.8, a.TZ)).lerp(new V3(-0.2, 0.4, -1.7), ease(k6)); a.kvK.position.y += Math.sin(k6 * Math.PI) * 2.6;
      a.kvV.position.copy(new V3(a.tx(a.qi), 1.15, a.TZ)).lerp(new V3(0.2, 0.4, -1.7), ease(k6)); a.kvV.position.y += Math.sin(k6 * Math.PI) * 2.6;
    }
    if (p7 >= 1 && !a.popped) { a.popped = true; o.flash = 1.5; sfx.pop(); toast('ATTENTION COMPLETE'); }
  }

  // ------------------------------------------------------------ dialog box
  // RPG-style typewriter. Clicking the box (or Space) finishes the line; when a run is waiting, it advances.
  let typeTimer = null;
  const dlg = { typing: false, text: '' };
  function say(p, text, name, opts = {}) {
    const port = $('#portrait'); port.style.setProperty('--c', p ? p.color : '#83769c'); port.textContent = p ? p.K.icon : '!';
    $('#dialog-name').textContent = (name || (p ? p.title : 'GUIDE')).toUpperCase();
    const box = $('#dialog-text'); clearInterval(typeTimer);
    const s = String(text); let i = 0;
    const perTick = Math.max(1, Math.round(((opts.cps || 70) * 0.025)));
    dlg.typing = true; dlg.text = s;
    box.innerHTML = '<span class="caret">_</span>';
    typeTimer = setInterval(() => { i += perTick; box.innerHTML = esc(s.slice(0, i)) + '<span class="caret">_</span>'; if (i >= s.length) finishTyping(); }, 25);
  }
  function finishTyping() { clearInterval(typeTimer); dlg.typing = false; $('#dialog-text').innerHTML = esc(dlg.text); }
  function toast(msg) { const t = el('div', 'toast', esc(msg)); $('#toasts').appendChild(t); setTimeout(() => t.remove(), 2300); }

  // ------------------------------------------------------------ XP / coins
  function level() { return Math.floor(save.xp / 100) + 1; }
  function gainXP(n, msg) {
    const before = level(); save.xp += n; persist(); renderStats();
    if (msg) toast(`${msg}  +${n}XP`);
    if (level() > before) { sfx.levelup(); toast(`LEVEL UP! LV ${level()}`); }
  }
  function gainCoins(n) { save.coins += n; persist(); renderStats(); }
  function renderStats() {
    $('#lv').textContent = 'LV ' + level();
    $('#xpfill').style.width = (save.xp % 100) + '%';
    $('#coins').textContent = 'C ' + save.coins;
    $('#btn-sound').textContent = save.muted ? 'MUTE' : 'SND';
    $('#btn-pix').textContent = 'PX: ' + (save.pix || 'chunky').toUpperCase();
    $('#hearts').textContent = quest ? '♥'.repeat(Math.max(0, quest.hearts)) + '♡'.repeat(Math.max(0, 3 - quest.hearts)) : '';
    if (quest && quest.single) $('#hearts').textContent = '';
  }

  // ------------------------------------------------------------ token stream bar
  const stream = { ctx: [], gen: [], next: 0 };
  function resetStream() {
    const d = world.m.demo; stream.ctx = d.prompt.slice(); stream.gen = []; stream.next = 0;
    renderTokens();
  }
  function renderTokens(curIndex = -1) {
    const box = $('#tokens'); box.innerHTML = '';
    box.appendChild(el('span', 'tok label', 'CONTEXT:'));
    const all = stream.ctx.concat(stream.gen);
    all.forEach((t, i) => { const s = el('span', 'tok' + (i >= stream.ctx.length ? ' gen' : '') + (i === curIndex ? ' cur' : ''), esc(t.replace(/^ /, ' '))); box.appendChild(s); });
  }

  // ------------------------------------------------------------ flow simulation
  // Paced for humans: STEP mode waits at every stop until the player presses NEXT (like an RPG dialog);
  // AUTO mode holds each stop for as long as its narration takes to read. Layer 2 is a quick replay, and every
  // token after the first takes an "express" trip, so the full tour is only sat through once.
  let flow = null, watchPiece = null, follow = save.follow !== false, speed = 1, keepRunning = false, tokensRun = 0;
  let runMode = save.runMode === 'auto' ? 'auto' : 'step';
  const SPEEDS = [0.5, 1, 2, 4];
  const TRAVEL = 1.6, QUICK_TRAVEL = 0.55, QUICK_DWELL = 0.75, VIS = 2.6, FF_TIME = 2.8;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const readTime = (s) => clamp(1.6 + String(s).length / 17, 3, 12); // ~190 words/min plus a beat to look at the 3D
  const narrationCps = () => 38 * Math.max(1, speed);

  function buildJourney(m, express) {
    const steps = [];
    m.sections.forEach((sec) => {
      const rep = sec.block ? (sec.block.repeat || 1) : 1, vis = Math.min(rep, express ? 1 : 2); // express skips the layer-2 replay
      for (let L = 1; L <= vis; L++) sec.pieces.forEach((p, k) => steps.push({ pi: p.index, sec, layer: L, rep, loop: L > 1 && k === 0, ffAfter: L === vis && k === sec.pieces.length - 1 && rep > vis }));
    });
    return steps;
  }
  const isQuick = (st, o) => flow.express || st.layer > 1 || (watchPiece && watchPiece !== o);

  function startFlow(opts = {}) {
    if (!world || flow) return;
    const m = world.m, all = stream.ctx.concat(stream.gen);
    const word = all[all.length - 1];
    const cont = m.demo.continuation;
    const next = cont[stream.next % cont.length];
    const express = !opts.full && !watchPiece && tokensRun > 0;
    const steps = buildJourney(m, express);
    flow = { steps, i: 0, phase: 'intro', t: 0, el: 0, word, next, id: hash(word) % (m.vocab || 50000), posIdx: all.length - 1, paused: false, ghosts: [], ffT: 0, done: false, express,
      total: steps.filter((s) => s.layer === 1).length, waiting: false, advanceReq: false };
    flow.label = tokText(word);
    world.packet.visible = true; world.packetLabel.style.display = '';
    world.packet.position.copy(inRoute()[0]);
    world.pieces.forEach((o) => { if (o.B.slots) o.B.slots.forEach((s, i) => { s.visible = i < Math.min(all.length - 1, 12); s.material = o.mats['slot' + i] = o.mats['slot' + i] || toon(slotColor(all[i])); }); });
    renderTokens(all.length - 1);
    const how = runMode === 'step' ? 'Press NEXT (or Space) at each stop to move on.' : 'AUTO: each stop lasts as long as it takes to read.';
    flow.text = express
      ? `Next token: ${tokText(word)} takes the same trip, express this time (no stops). Want the full tour again? Click any piece and press WATCH IT.`
      : `The model has already read the prompt, and those tokens wait in the KV cache racks. Now the newest token, ${tokText(word)}, rides the conveyor to predict the next word. ${how}`;
    flow.wait = !express && runMode === 'step';
    say(null, flow.text, express ? 'EXPRESS TRIP' : 'HOW IT RUNS', { cps: narrationCps() });
    if (follow) { cam.goal.radius = Math.min(cam.goal.radius, 24); cam.goal.target.copy(world.packet.position); }
    syncFlowBtn(); sfx.start();
  }
  function slotColor(t) { return ['#29adff', '#ff77a8', '#00e436', '#ffa300', '#b06bff', '#ffec27'][hash(t || '') % 6]; }
  function stopFlow(silent) {
    flow = null; watchPiece = null;
    $('#dlg-next').hidden = true; $('#dialog').classList.remove('waiting');
    if (!world) return;
    world.packet.visible = false; world.packetLabel.style.display = 'none';
    world.ghost.visible = false; world.ghostLabel.style.display = 'none';
    world.minis.forEach((m) => (m.visible = false)); world.beams.visible = false;
    world.pieces.forEach((o) => { o.active = 0; if (o.B.cabs) o.B.cabs.forEach((c) => (c.lamp.material = o.mats['#5f574f'])); });
    world.rooms.forEach((r) => r.sign && (r.sign.querySelector('small').textContent = stackedText(r.sec.block.repeat || 1)));
    if (!silent) syncFlowBtn();
  }
  function syncFlowBtn() {
    const b = $('#btn-flow');
    b.innerHTML = flow ? (flow.paused ? '&#9654; RESUME' : '&#10073;&#10073; PAUSE') : (stream.gen.length ? '&#9654; NEXT TOKEN' : '&#9654; RUN');
    b.classList.toggle('on', !!(flow && !flow.paused));
    $('#btn-mode').textContent = 'MODE: ' + runMode.toUpperCase();
  }
  function setWaiting(on) { flow.waiting = on; showNext(on); }
  // NEXT button / Space / clicking the dialog
  function advance() {
    if (dlg.typing) { finishTyping(); return; }
    if (flow && flow.waiting) { setWaiting(false); flow.advanceReq = true; sfx.tick(); }
    else if (att && att.waiting) { att.waiting = false; showNext(false); att.advanceReq = true; }
  }
  // Has the current stop (intro, visit or fast-forward) been on screen long enough?
  function stopDone(minEl) {
    if (flow.wait) {
      if (!flow.waiting && !flow.advanceReq && !dlg.typing && flow.el >= minEl) setWaiting(true);
      return flow.advanceReq;
    }
    return flow.el >= Math.max(minEl, readTime(flow.text)) && !dlg.typing;
  }
  function enterStop() { flow.el = 0; flow.advanceReq = false; setWaiting(false); }

  function flowCtx(o) {
    const m = world.m, p = o.p, all = stream.ctx.concat(stream.gen);
    return { word: tokText(flow.word), id: flow.id, d: m.d, pos: flow.posIdx, hidden: p.hidden || m.d * 4, cache: all.length, k: p.active || 2, experts: p.experts || 8, shared: !!p.shared, vocab: m.vocab, next: tokText(flow.next), name: p.title, layer: flow.steps[flow.i].layer, layers: flow.steps[flow.i].rep };
  }
  function narrate(o) {
    const c = flowCtx(o); const st = flow.steps[flow.i];
    let text = o.p.flow ? o.p.flow.replace(/\{(\w+)\}/g, (_, k) => (c[k] != null ? num(c[k]) : '')) : o.p.K.flow(c);
    if (o.p.kind === 'attention') {
      const v = o.p.variant;
      if (v === 'sliding' || (v === 'alternating' && st.layer % 2 === 1)) text += ` This is a sliding-window layer, so it only looks back ${num(o.p.window || 1024)} tokens (red band).`;
      if (v === 'alternating' && st.layer % 2 === 0) text += ' This layer is a full-attention layer: it can see the whole context.';
      if (v === 'mla') text += ' K and V are squeezed into a small latent vector before caching (purple funnel), so the cache is much smaller.';
      if (o.p.kvHeads && o.p.heads && o.p.kvHeads < o.p.heads) text += ` ${o.p.heads} query heads share just ${o.p.kvHeads} K/V heads.`;
    }
    if (st.sec.block) text = `[Layer ${st.layer} of ${num(st.rep)}] ` + text;
    const stopNo = flow.steps.slice(0, flow.i + 1).filter((s) => s.layer === 1).length;
    flow.text = text;
    say(o.p, text, `${o.p.title}  ·  STOP ${stopNo} OF ${flow.total}`, { cps: narrationCps() });
  }

  function onEnter(o) {
    const st = flow.steps[flow.i];
    o.active = 1; o.activeT = 0; o.flash = 1; sfx.tick();
    enterStop();
    flow.q = isQuick(st, o);
    const watched = watchPiece === o;
    if (watched) watchPiece = null;
    flow.wait = !flow.q && (runMode === 'step' || watched);
    if (st.sec.block) { const room = world.rooms.find((r) => r.sec === st.sec); room.sign.querySelector('small').textContent = `NOW: LAYER ${st.layer} / ${num(st.rep)}`; }
    const k = o.p.kind;
    if (k === 'tokenizer') flow.label = `#${flow.id}`;
    if (k === 'embedding') flow.label = `[1x${num(world.m.d)}]`;
    if (k === 'lmhead') flow.label = `[1x${num(world.m.vocab)}]`;
    if (k === 'moe') {
      const n = o.B.cabs.length, kk = Math.min(o.p.active || 2, n, world.minis.length);
      o.chosen = shuffle([...Array(n).keys()]).slice(0, kk);
      const lit = o.mats['#ffec27'] || (o.mats['#ffec27'] = toon('#ffec27'));
      o.B.cabs.forEach((c, i) => (c.lamp.material = o.chosen.includes(i) ? lit : o.mats['#5f574f']));
    }
    if (k === 'attention' && st.layer === 1 && o.B.slots) {
      const all = stream.ctx.concat(stream.gen); const idx = Math.min(all.length - 1, 11);
      flow.pendingSlot = { o, idx };
    }
    // residual: if a later add piece branches from here, launch the bypass copy (it moves in step with the main token)
    const addObj = world.pieces.find((a) => a.p.residualFrom === o.p.id && a.p.section === o.p.section);
    if (addObj) {
      let j = flow.i; while (j < flow.steps.length && flow.steps[j].pi !== addObj.p.index) j++;
      flow.ghosts = [{ add: addObj, i0: flow.i, n: Math.max(1, j - flow.i) }];
      world.ghost.visible = true; world.ghostLabel.style.display = '';
    }
    if (k === 'add') { flow.ghosts = []; world.ghost.visible = false; world.ghostLabel.style.display = 'none'; }
    if (!flow.q) narrate(o);
    else if (st.layer > 1 && st.loop && !flow.express) { flow.text = `Layer 2 of ${num(st.rep)}: the exact same steps again, but with this layer's own weights. Quick replay...`; say(null, flow.text, 'LAYER 2', { cps: narrationCps() }); }
  }
  function onExit(o) {
    o.active = 0;
    if (o.p.kind === 'moe' && o.B.cabs) o.B.cabs.forEach((c) => (c.lamp.material = o.mats['#5f574f']));
    if (flow.pendingSlot && flow.pendingSlot.o === o) { const s = o.B.slots[flow.pendingSlot.idx]; if (s) { s.visible = true; s.material = toon(slotColor(flow.word)); } flow.pendingSlot = null; }
    if (o.p.kind === 'sampler' && !flow.popped) finishToken(o);
  }
  function finishToken(o) {
    flow.popped = true;
    const out = flow.next;
    const pop = addLabel('pop', esc(out.replace(/^ /, ' ')) + '!'); const pp = pos(o).clone(); pp.y += 3.5; placeLabel(pop, pp); setTimeout(() => pop.remove(), 1500);
    sfx.pop(); gainCoins(1);
    stream.gen.push(out); stream.next++;
    const cont = world.m.demo.continuation;
    if (stream.next >= cont.length) { toast('SENTENCE COMPLETE!'); gainXP(15); }
    renderTokens();
    if (flow.q) { flow.text = `Out pops ${tokText(out)}!`; say(o.p, flow.text, 'SAMPLER'); }
    flow.done = true;
  }
  function endOfToken() {
    const f = flow, out = f.next;
    stopFlow(); tokensRun++;
    if (!f.express) gainXP(15, 'FULL TRIP');
    const more = runMode === 'auto' && keepRunning;
    const text = f.express
      ? `${tokText(out)} joins the context.${more ? ' Next token coming up...' : ' Press NEXT TOKEN for another.'}`
      : `That's one full trip: ${tokText(f.word)} went in and ${tokText(out)} came out. It now joins the context, and writing a whole paragraph is just this loop, one token at a time. ${more ? 'Next token coming up (express trip)...' : 'Press NEXT TOKEN to watch the next one (express trip).'}`;
    say(null, text, 'ONE TOKEN DONE');
    if (follow) setTimeout(() => { if (world && !flow) fitCamera(false); }, 1200);
    if (more) setTimeout(() => { if (world && !flow && keepRunning && runMode === 'auto') startFlow(); }, (f.express ? 1.8 : readTime(text)) * 1000 / speed);
  }

  function updateFlow(dt) {
    if (!flow || flow.paused) return;
    const st = flow.steps[flow.i]; const o = world.pieces[st.pi];
    const sdt = dt * speed;
    // residual bypass ghost: progress = how far the main token has travelled since the branch point
    flow.ghosts.forEach((g) => {
      const travelled = flow.phase === 'travel' ? flow.i - 1 - g.i0 + ease(flow.t) : flow.i - g.i0;
      const r = skipRoute(g.add, g.add.skipK || 0); if (!r) return;
      world.ghost.position.copy(polyAt(r, clamp(travelled / g.n, 0, 1))); world.ghost.rotation.y += sdt * 4;
    });
    if (flow.phase === 'intro') {
      flow.el += sdt;
      world.packet.position.copy(inRoute()[0]).setY(PIPE_Y + Math.abs(Math.sin(flow.el * 3)) * 0.3);
      if (flow.express ? flow.el >= 2.2 : stopDone(1.0)) { flow.phase = 'travel'; flow.t = 0; setWaiting(false); }
    } else if (flow.phase === 'ff') {
      flow.el += sdt; flow.ffT = Math.min(1, flow.ffT + sdt / FF_TIME);
      const r = loopRoute(st.sec); world.packet.position.copy(polyAt(r, (flow.el * 0.9) % 1));
      const room = world.rooms.find((x) => x.sec === st.sec);
      const L0 = st.layer, L = Math.min(st.rep, Math.floor(L0 + flow.ffT * (st.rep - L0)));
      room.sign.querySelector('small').textContent = flow.ffT >= 1 ? `DONE: ALL ${num(st.rep)} LAYERS` : `FAST-FORWARD: LAYER ${L} / ${num(st.rep)}`;
      if (flow.ffT < 1 && Math.random() < 0.2) sfx.tick();
      if (flow.ffT >= 1 && (flow.express ? true : stopDone(FF_TIME))) { flow.phase = 'travel'; flow.t = 0; flow.i++; setWaiting(false); }
    } else if (flow.phase === 'travel') {
      flow.t += sdt / (isQuick(st, o) ? QUICK_TRAVEL : TRAVEL);
      let r;
      if (flow.i === 0) r = inRoute();
      else if (st.loop) r = loopRoute(st.sec);
      else r = route(world.pieces[flow.steps[flow.i - 1].pi], o);
      world.packet.position.copy(polyAt(r, ease(Math.min(1, flow.t))));
      if (flow.t >= 1) { flow.phase = 'visit'; flow.t = 0; onEnter(o); }
    } else {
      flow.el += sdt;
      const vt = flow.q ? clamp(flow.el / QUICK_DWELL, 0, 1) : (flow.el / VIS) % 1; // visual cycle repeats while you read
      const P = pos(o); world.packet.position.set(P.x, P.y + o.B.top + 0.6 + Math.abs(Math.sin(vt * Math.PI * 2)) * 0.45, P.z);
      o.activeT = vt;
      if (o.p.kind === 'moe' && o.chosen) {
        const from = pos(o).clone().add(o.B.router.position).setY(pos(o).y + 1.4);
        o.chosen.forEach((ci, i) => { const m = world.minis[i]; m.visible = true; const cab = o.B.cabs[ci].g; const to = pos(o).clone().add(cab.position).setY(pos(o).y + 1.2); const tt = Math.sin(clamp(vt * 1.15, 0, 1) * Math.PI); m.position.copy(from).lerp(to, tt); m.position.y += Math.sin(tt * Math.PI) * 1.2; });
      }
      if (o.p.kind === 'attention' && o.B.slots) {
        const arr = world.beams.geometry.attributes.position.array; let n = 0;
        const vis = o.B.slots.filter((s) => s.visible);
        const v = o.p.variant;
        const sliding = v === 'sliding' || (v === 'alternating' && st.layer % 2 === 1);
        const lookN = sliding ? Math.min(vis.length, o.p.windowShow || 3) : vis.length;
        const from = world.packet.position;
        vis.slice(vis.length - lookN).forEach((s) => { const wp = s.getWorldPosition(new V3()); arr.set([from.x, from.y, from.z, wp.x, wp.y, wp.z], n * 6); n++; });
        world.beams.geometry.setDrawRange(0, n * 2); world.beams.geometry.attributes.position.needsUpdate = true; world.beams.visible = n > 0 && vt > 0.1 && vt < 0.9;
      }
      if (o.p.kind === 'sampler' && !flow.popped && flow.el >= (flow.q ? 0.4 : 1.6)) finishToken(o);
      const leave = flow.q ? flow.el >= QUICK_DWELL : stopDone(1.4);
      if (leave) {
        world.minis.forEach((m) => (m.visible = false)); world.beams.visible = false; setWaiting(false);
        onExit(o);
        if (flow.done) { endOfToken(); return; }
        if (st.ffAfter) {
          flow.phase = 'ff'; flow.ffT = 0; enterStop(); flow.wait = !flow.express && runMode === 'step';
          if (!flow.express) { flow.text = `Every one of the ${num(st.rep)} layers in this block has the same shape (each with its own weights), so watching more of them would look identical. Fast-forwarding through layers 3 to ${num(st.rep)}...`; say(null, flow.text, 'FAST-FORWARD', { cps: narrationCps() }); }
          sfx.whoosh(); return;
        }
        flow.i++; flow.phase = 'travel'; flow.t = 0;
      }
    }
    world.packetLabel.textContent = flow.label;
  }

  // ------------------------------------------------------------ quests
  let quest = null;
  function autoQuestions(m) {
    const out = [];
    const kinds = [...new Set(m.pieces.map((p) => p.kind))];
    m.pieces.forEach((p) => {
      const dupes = m.pieces.filter((q) => q.title === p.title).length;
      if (dupes === 1) out.push({ type: 'find', auto: true, piece: p.id, q: `Click the piece that does this: ${p.blurb || p.K.blurb}`, answer: p.id, explain: `That's the ${p.title}. ${p.blurb || p.K.blurb}` });
    });
    kinds.forEach((k) => {
      const p = m.pieces.find((x) => x.kind === k); if (!p) return;
      const wrong = shuffle(Object.keys(KINDS).filter((x) => x !== k && x !== 'custom')).slice(0, 3).map((x) => KINDS[x].blurb);
      const opts = shuffle([p.blurb || p.K.blurb, ...wrong]);
      out.push({ type: 'choice', auto: true, piece: p.id, q: `What does the ${p.title} do?`, options: opts, answer: opts.indexOf(p.blurb || p.K.blurb), explain: p.detail || p.K.detail });
    });
    return out;
  }
  function questionsForPiece(p) {
    const m = world.m;
    const own = m.quiz.filter((q) => q.piece === p.id || q.answer === p.id);
    const auto = autoQuestions(m).filter((q) => q.piece === p.id);
    return shuffle(own).concat(shuffle(auto)).slice(0, 1);
  }
  function startQuest(qs, opts = {}) {
    if (!world) return;
    if (!qs) { const m = world.m; qs = shuffle(m.quiz).concat(shuffle(autoQuestions(m))).slice(0, 8); }
    if (!qs.length) return;
    // shuffle answer order so the right answer isn't always in the same slot
    qs = qs.map((q) => { if (q.type === 'find' || !q.options) return q; const order = shuffle(q.options.map((_, i) => i)); return Object.assign({}, q, { options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) }); });
    quest = { qs, i: 0, hearts: 3, correct: 0, single: !!opts.single };
    renderStats(); sfx.start();
    showQuestion();
  }
  function endQuest() { quest = null; document.body.classList.remove('finding'); $('#modal').hidden = true; $('#findbar').hidden = true; renderStats(); }
  function showQuestion() {
    const q = quest.qs[quest.i];
    const meta = quest.single ? 'QUICK QUIZ' : `QUESTION ${quest.i + 1} / ${quest.qs.length}`;
    if (q.type === 'find') {
      $('#modal').hidden = true;
      const bar = $('#findbar'); bar.hidden = false; document.body.classList.add('finding');
      bar.innerHTML = `<div class="q"><span class="tag">${meta} · FIND IT IN 3D</span>${esc(q.q)}</div><button class="pbtn small" data-a="skip">SKIP</button>`;
      bar.onclick = (e) => { if (e.target.closest('[data-a=skip]')) answer(null); };
      select(null);
      return;
    }
    $('#findbar').hidden = true; document.body.classList.remove('finding');
    const modal = $('#modal'); modal.hidden = false;
    modal.innerHTML = `<div class="mbox pbox"><div class="meta"><span>${meta}</span><span>${esc(world.m.name)}</span></div>
      <div class="qtext">${esc(q.q)}</div>
      <div class="opts">${q.options.map((o, i) => `<button class="pbtn opt" data-i="${i}"><span class="k">${'ABCD'[i]}</span>${esc(o)}</button>`).join('')}</div>
      <div class="fb"></div></div>`;
    modal.onclick = (e) => { const b = e.target.closest('.opt'); if (b && !quest.answered) answer(+b.dataset.i, b); };
    quest.answered = false;
  }
  function answer(val, btn) {
    const q = quest.qs[quest.i]; quest.answered = true;
    let ok;
    if (q.type === 'find') {
      const target = world.m.byId[q.answer];
      const got = val && world.m.byId[val];
      ok = !!(got && target && (got.id === target.id || got.title === target.title || (q.acceptBlock && got.block && got.block === target.block)));
      const t = world.byId[q.answer]; if (t) { t.flash = 2; }
    } else {
      ok = val === q.answer;
      document.querySelectorAll('.opt').forEach((b, i) => { if (i === q.answer) b.classList.add('right'); else if (i === val) b.classList.add('wrong'); b.disabled = true; });
    }
    if (ok) { quest.correct++; sfx.coin(); gainCoins(10); gainXP(25); }
    else { quest.hearts--; sfx.wrong(); renderStats(); }
    const last = quest.i >= quest.qs.length - 1 || (!quest.single && quest.hearts <= 0);
    const modal = $('#modal');
    const verdict = ok ? 'CORRECT! +10C' : (val == null ? 'SKIPPED' : 'NOT QUITE!');
    const ans = !ok && q.type === 'find' && world.m.byId[q.answer] ? `Answer: the ${world.m.byId[q.answer].title} (now flashing).` : '';
    modal.hidden = false;
    const fb = `<h2 style="color:${ok ? 'var(--green)' : 'var(--red)'}">${verdict}</h2><div class="explain">${esc([ans, q.explain].filter(Boolean).join(' '))}</div><div class="mfoot"><button class="pbtn gold" data-a="next">${last ? 'FINISH' : 'NEXT &gt;'}</button></div>`;
    if (q.type === 'find') { $('#findbar').hidden = true; document.body.classList.remove('finding'); modal.innerHTML = `<div class="mbox pbox">${fb}</div>`; }
    else { modal.querySelector('.fb').innerHTML = fb; }
    if (!ok) modal.querySelector('.mbox').classList.add('shake');
    modal.onclick = (e) => { if (e.target.closest('[data-a=next]')) { if (last) results(); else { quest.i++; showQuestion(); } } };
  }
  function results() {
    const m = world.m, q = quest;
    if (q.single) { endQuest(); return; }
    const total = q.qs.length, score = q.correct;
    const st = mstate(m.id); st.best = Math.max(st.best || 0, score); st.total = total; persist();
    const pct = score / total, rank = pct === 1 ? 'S' : pct >= 0.75 ? 'A' : pct >= 0.5 ? 'B' : 'C';
    if (rank === 'S') sfx.levelup();
    const modal = $('#modal'); modal.hidden = false; $('#findbar').hidden = true;
    modal.innerHTML = `<div class="mbox pbox"><h2>QUEST COMPLETE: ${esc(m.name.toUpperCase())}</h2>
      <div class="rank">${rank}</div><div class="big-score">${score} / ${total}</div>
      <p style="text-align:center">${q.hearts <= 0 ? 'Out of hearts! Inspect the pieces and try again.' : rank === 'S' ? 'Flawless. You could draw this diagram from memory.' : 'Click pieces you missed to read about them, then run it back.'}</p>
      <div class="mfoot"><button class="pbtn" data-a="close">BACK TO MODEL</button><button class="pbtn gold" data-a="again">PLAY AGAIN</button></div></div>`;
    modal.onclick = (e) => { const a = e.target.closest('[data-a]'); if (!a) return; endQuest(); if (a.dataset.a === 'again') startQuest(); };
  }

  // ------------------------------------------------------------ input
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function setNdc(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function pick(e) {
    if (!world) return null; setNdc(e);
    const hits = ray.intersectObjects(world.pieces.map((o) => o.g), true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.pieceId) o = o.parent; if (o) return world.byId[o.userData.pieceId]; }
    return null;
  }
  const pointers = new Map();
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!world) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or stale pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), r: cam.goal.radius, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; return; }
    const hit = pick(e);
    // pieces are fixed in place (moving them wouldn't change the simulation); a press on one is a click.
    // Dragging rotates the view; WASD slides the map (two fingers slide it on touch screens, which have no keys).
    drag = { mode: 'orbit', click: e.button === 0, o: hit, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!world) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) { const h = pick(e); if (h !== world.hovered) { world.hovered = h; canvas.style.cursor = h ? 'pointer' : 'grab'; } return; }
    if (drag.mode === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); cam.goal.radius = clamp(drag.r * (drag.dist / Math.max(d, 1)), 8, 160);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; panBy(mx - drag.mx, my - drag.my); drag.mx = mx; drag.my = my; // two fingers moving together slide the map
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) { drag.moved = true; canvas.style.cursor = 'grabbing'; }
    if (!drag.moved) return;
    orbitBy(dx, dy);
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (!drag) return;
    if (drag.mode === 'pinch') { if (pointers.size === 0) drag = null; return; }
    if (drag.click && !drag.moved) { if (drag.o) onPieceClick(drag.o); else if (!quest) select(null); }
    drag = null; canvas.style.cursor = world && world.hovered ? 'pointer' : 'grab';
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.goal.radius = clamp(cam.goal.radius * Math.exp(e.deltaY * 0.0012), 8, 160); }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const h = pick(e); if (h) focusOn(h); });

  function onPieceClick(o) {
    if (!o) return;
    if (WS && WS.onPieceClick(o)) return;
    if (quest && quest.qs[quest.i].type === 'find' && !quest.answered) { answer(o.p.id); return; }
    if (quest) return;
    select(o);
  }

  // ------------------------------------------------------------ toolbar
  function recenter() { fitCamera(false); sfx.whoosh(); }
  $('#btn-flow').onclick = () => { if (!flow) { keepRunning = true; startFlow(); } else { flow.paused = !flow.paused; keepRunning = !flow.paused; syncFlowBtn(); } };
  $('#btn-mode').onclick = () => {
    runMode = runMode === 'step' ? 'auto' : 'step'; save.runMode = runMode; persist(); sfx.tick();
    if (flow) { if (runMode === 'auto' && flow.waiting) advance(); else if (runMode === 'step' && !flow.q && !flow.express) flow.wait = true; else flow.wait = false; }
    toast(runMode === 'step' ? 'STEP: PRESS NEXT AT EACH STOP' : 'AUTO: STOPS LAST AS LONG AS IT TAKES TO READ');
    syncFlowBtn();
  };
  $('#dlg-next').onclick = (e) => { e.stopPropagation(); advance(); };
  $('#dialog').onclick = () => advance();
  $('#btn-speed').onclick = () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; $('#btn-speed').textContent = 'SPD x' + speed; sfx.tick(); };
  $('#btn-follow').onclick = () => { follow = !follow; save.follow = follow; persist(); $('#btn-follow').textContent = follow ? 'CAM: FOLLOW' : 'CAM: FREE'; $('#btn-follow').classList.toggle('on', follow); if (!follow) fitCamera(false); else cam.goal.radius = 22; };
  $('#btn-recenter').onclick = recenter;
  $('#btn-quest').onclick = () => startQuest();
  $('#btn-levels').onclick = () => showTitle();
  $('#btn-sound').onclick = () => { save.muted = !save.muted; persist(); renderStats(); };
  $('#btn-help').onclick = showHelp;
  $('#btn-pix').onclick = () => { const k = Object.keys(PIX_MODES); save.pix = k[(k.indexOf(save.pix || 'chunky') + 1) % k.length]; persist(); resize(); renderStats(); sfx.tick(); };
  const PAN_KEYS = { a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const heldPan = new Set();
  window.addEventListener('keyup', (e) => { heldPan.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
  window.addEventListener('blur', () => heldPan.clear());
  function updateKeyPan(dt) {
    if (!heldPan.size) return;
    let x = 0, y = 0; heldPan.forEach((k) => { x += PAN_KEYS[k][0]; y += PAN_KEYS[k][1]; });
    const px = Math.min(W, H) * 0.9 * dt; // about a screen's width per second, whatever the zoom
    panBy(-x * px, -y * px);
  }
  window.addEventListener('keydown', (e) => {
    if (!world || $('#title').hidden === false) return;
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const pk = PAN_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (pk && !e.metaKey && !e.ctrlKey) { e.preventDefault(); heldPan.add(e.key.length === 1 ? e.key.toLowerCase() : e.key); if (!e.repeat) panBy(-pk[0] * 40, -pk[1] * 40); return; }
    if (WS && WS.building()) return; // the workshop has its own controls; Space/Q/F would start things that don't apply
    if (e.key === 'Escape') { if (!$('#help').hidden) $('#help').hidden = true; else if (quest) endQuest(); else select(null); }
    if (quest) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if ((flow && (flow.waiting || (dlg.typing && flow.wait))) || (att && (att.waiting || dlg.typing))) advance(); else if (e.key === ' ') $('#btn-flow').click(); }
    if (e.key === 'r' || e.key === 'R') recenter();
    if (e.key === 'q' || e.key === 'Q') startQuest();
    if (e.key === 'f' || e.key === 'F') $('#btn-follow').click();
  });

  function showHelp() {
    const h = $('#help'); h.hidden = false;
    const legend = Object.entries(KINDS).filter(([k]) => k !== 'custom').map(([, K]) => `<div style="--c:${K.color}"><i></i>${esc(K.title)}</div>`).join('');
    h.innerHTML = `<div class="mbox pbox"><h2>CONTROLS</h2><div class="keys">
      <div><b>CLICK PIECE</b>inspect it</div>
      <div><b>DRAG</b>rotate view</div><div><b>WASD / ARROWS</b>move around the map</div><div><b>2 FINGERS</b>pinch to zoom, move to slide the map</div><div><b>WHEEL/PINCH</b>zoom</div><div><b>DOUBLE-CLICK</b>zoom to piece</div>
      <div><b>SPACE</b>run / next stop / pause</div><div><b>MODE</b>STEP waits for you, AUTO reads at your pace</div><div><b>R</b>recenter view</div><div><b>Q</b>quest</div><div><b>F</b>follow cam</div></div>
      <h2 style="margin-top:16px">LEGEND</h2><div class="legend">${legend}<div style="--c:#ffc23a"><i></i>Residual bypass pipe</div><div style="--c:#5a5480"><i></i>Layer loop-back pipe</div></div>
      <p>The yellow cube is a token. Gold bypass pipes are residual connections. The rack behind each attention unit is its KV cache. Rooms with mint floors are transformer blocks; the sign says how many times each is stacked.</p>
      <div class="mfoot"><button class="pbtn gold" data-a="x">GOT IT</button></div></div>`;
    h.onclick = (e) => { if (e.target === h || e.target.closest('[data-a]')) h.hidden = true; };
  }

  // ------------------------------------------------------------ title screen
  function showTitle() {
    if (WS) WS.close();
    clearWorld(); endQuest(); $('#inspector').hidden = true;
    $('#hud').hidden = true; $('#title').hidden = false;
    const box = $('#carts'); box.innerHTML = '';
    if (!MODELS.length) box.innerHTML = '<p>No models found. Check models/manifest.js.</p>';
    MODELS.forEach((m) => {
      const st = mstate(m.id);
      const b = el('button', 'cart');
      b.style.setProperty('--c', m.cartColor || '#29adff');
      b.innerHTML = `<div class="grip"></div><div class="label"><div class="maker">${esc(m.maker || '')} · ${esc(m.year || '')}</div><div class="name">${esc(m.name)}</div><div class="tag">${esc(m.tagline || '')}</div>
        <div class="chips">${(m.stats || []).slice(0, 4).map(([k, v]) => `<span>${esc(k)} ${esc(v)}</span>`).join('')}</div></div>
        <div class="prog"><span>* ${st.seen.length}/${m.pieces.length} PIECES</span><span>BEST ${st.best || 0}/${st.total || 8}</span></div>`;
      b.onclick = () => openModel(m);
      box.appendChild(b);
    });
  }
  function openModel(m) {
    sfx.start();
    $('#title').hidden = true; $('#hud').hidden = false;
    $('#cart-name').innerHTML = `${esc(m.name)}<small>${esc(m.maker || '')} ${esc(m.year || '')}</small>`;
    buildWorld(m); resetStream(); renderStats(); select(null); tokensRun = 0; syncFlowBtn();
    $('#btn-follow').textContent = follow ? 'CAM: FOLLOW' : 'CAM: FREE'; $('#btn-follow').classList.toggle('on', follow);
    say(null, m.intro || `Welcome to ${m.name}! Every block here is a real part of the model. Click one to inspect it, or press RUN to watch a token travel through. Gold pipes are skip connections, mint rooms are the stacked transformer blocks.`, 'GUIDE');
  }

  // ------------------------------------------------------------ main loop
  const clock = new THREE.Clock(); let T = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05); T += dt;
    if (world) {
      let moving = false;
      world.pieces.forEach((o) => {
        const g = o.g, k = 1 - Math.pow(0.0005, dt);
        const tgt = o.target;
        if (g.position.distanceToSquared(tgt) > 1e-5) { g.position.lerp(tgt, k); moving = true; }
        if (o.flash > 0) {
          o.flash = Math.max(0, o.flash - dt * 1.5);
          const on = o.flash > 0 && ((T * 10) | 0) % 2 === 0;
          Object.values(o.mats).forEach((mt) => mt.emissive && mt.emissive.setRGB(on ? 0.35 : 0, on ? 0.35 : 0, on ? 0.3 : 0));
        }
        o.B.anim(T, dt, !!o.active || !!o.grinding, o.activeT || 0);
        const near = camera.position.distanceTo(g.position) < 44 || o === world.hovered || o === world.selected || o.active || (flow && world.pieces[flow.steps[flow.i].pi] === o);
        if (!near || (world.focus && world.focus !== o)) o.label.style.display = 'none'; else placeLabel(o.label, tmpV.set(g.position.x, g.position.y + o.B.top + 0.4, g.position.z).clone());
      });
      if (moving || world.dirty) { rebuildPipes(); world.dirty = false; }
      world.rooms.forEach((r) => { if (!r.sign || !r.signPos) return; if (world.focus) r.sign.style.display = 'none'; else placeLabel(r.sign, r.signPos); });
      world.arrow.visible = !!world.selected && !world.focus;
      if (world.selected) { const p = pos(world.selected); world.arrow.position.set(p.x, p.y + world.selected.B.top + 1.4 + Math.abs(Math.sin(T * 4)) * 0.3, p.z); world.arrow.rotation.y += dt * 2; }
      updateFlow(dt);
      updateGrind(dt);
      updateEmb(dt);
      updateAtt(dt);
      if (flow) {
        world.packet.rotation.y += dt * 3;
        placeLabel(world.packetLabel, world.packet.position.clone().setY(world.packet.position.y + 0.6));
        if (world.ghost.visible) placeLabel(world.ghostLabel, world.ghost.position.clone().setY(world.ghost.position.y + 0.4));
        if (follow && T - camTouched > 4) { cam.goal.target.lerp(world.packet.position.clone().setY(0.6).add(new V3(0, 0, 2.5)), 0.06); } // aim a little in front so the token sits above the dialog box
      }
    }
    if (world) updateKeyPan(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
  }
  // ------------------------------------------------------------ workshop (workshop.js): build your own LLM from the same parts
  function testRun() { if (!world) return; stopFlow(true); select(null); watchPiece = null; keepRunning = false; tokensRun = 0; resetStream(); fitCamera(false); startFlow({ full: true }); }
  const WS = typeof LLMArcade.workshop === 'function' ? LLMArcade.workshop({
    $, el, esc, num, KINDS, MODELS, sfx, save, persist, prepModel, buildWorld, clearWorld, fitCamera, setInset, testRun, stopFlow, select,
    toast, gainXP, gainCoins, renderStats, showTitle, world: () => world,
  }) : null;

  frame();
  showTitle();
}

boot();
})();
