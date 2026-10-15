/* LLM Arcade workshop: build an LLM out of the parts you've been inspecting.
 * BLUEPRINTS: rebuild a real cartridge slot by slot. Each empty slot describes its job; the player picks the part,
 *   then its type (GQA or MHA? RMSNorm or LayerNorm?). HINT gives three nudges per slot before showing the answer;
 *   stars reward few hints, no answers and few mistakes.
 * FREE BUILD: a sandbox. A foreman checks the wiring as you go, meters show size / active size / KV cache,
 *   a "looks like" detector says which cartridge your design resembles and what would make it match, and challenges
 *   give goals. Any cartridge can be remixed as a starting point.
 * A build is turned into an ordinary model object, so the engine renders it and RUNs a token through it like a cartridge. */
(function () {
'use strict';

LLMArcade.workshop = function (api) {
  const { $, el, esc, num, KINDS, MODELS, sfx } = api;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------ parts
  const PARTS = ['tokenizer', 'embedding', 'posenc', 'norm', 'attention', 'add', 'ffn', 'moe', 'lmhead', 'sampler'];
  // blueprint slots describe the job, never the part's name, so the player has to work out which part does it
  const JOB = {
    tokenizer: 'Chops raw text into chunks and gives each chunk an ID number.',
    embedding: 'Swaps each ID number for a long list of numbers (a vector) that stands for its meaning.',
    posenc: 'Adds a learned "you are seat #5" signal to each vector, from a table of positions.',
    norm: 'Rescales the vector so no number gets too loud or too quiet.',
    attention: 'Lets the token look back at earlier tokens and pull in the context it needs.',
    add: 'Adds the untouched copy that skipped around the last step back onto its result.',
    ffn: 'Gives each token private thinking time: expand, activate, squeeze back.',
    moe: 'A router sends each token to a few specialist networks out of many.',
    lmhead: 'Scores every word in the vocabulary as the possible next token.',
    sampler: 'Turns the scores into probabilities and picks the next token.',
  };
  // HINT ladders: three nudges that get closer each time, then a fourth press shows the answer.
  // Nudge 1 points at the problem, nudge 2 at how the part works, nudge 3 at what it looks like in 3D.
  const HINTS = {
    tokenizer: ['Think about the very first thing that happens to text. The model can\'t read letters.', 'This part splits text into pieces. A rare word can become two or three pieces.', 'It\'s the orange machine with a hopper on top: words drop in, numbered chunks come out.'],
    embedding: ['Right now each token is just an ID number, and a number like #9246 doesn\'t mean anything yet.', 'This part is a giant lookup table with one row of numbers for every word in the vocabulary.', 'It\'s the bookshelf of colored cubes: the token\'s ID picks a row, and that row becomes its vector.'],
    posenc: ['Attention alone can\'t tell word order: "dog bites man" would look the same as "man bites dog".', 'This model fixes that with a learned table, one entry per seat in the sentence, added onto each vector.', 'It\'s the clock box. Newer models skip it and rotate Q and K with RoPE instead.'],
    norm: ['After dozens of layers, the numbers in a vector can blow up or shrink to almost nothing.', 'This part keeps the vector\'s overall size steady, like a volume limiter. Models use several of them.', 'It\'s the teal plate with equalizer bars that level out. Look for one next to each big sub-layer.'],
    attention: ['So far every token has been handled on its own. Something has to let the words talk to each other.', 'This part compares the token\'s query with earlier tokens\' keys, then blends in their values.', 'It\'s the blue unit with the KV-cache rack behind it: the "look back at the context" part.'],
    add: ['Something just changed the vector. What happened to the original copy from before that step?', 'The original copy took a shortcut around the sub-layer. This slot merges the two paths back together.', 'It\'s the small yellow node where the gold bypass pipe rejoins. It does a single + operation.'],
    ffn: ['Attention gathered context from the other tokens. Now this token needs time to process it privately.', 'This part makes the vector several times wider, runs it through an activation, then shrinks it back.', 'It\'s the green unit with a fan. Most of a dense model\'s parameters live in it.'],
    moe: ['This model is huge in total, but each token only uses a small slice of it.', 'A small router scores many specialist networks, and only the top few run for this token.', 'It\'s the grid of pink cabinets with a router box. It takes the place of the usual single feed-forward.'],
    lmhead: ['The layers are done. The final vector now has to become a guess about the next word.', 'This part gives every word in the vocabulary a score, with one big matrix multiply.', 'It\'s the red panel of bars: one bar for every possible next token.'],
    sampler: ['Scores aren\'t a decision yet. Something has to choose.', 'This part turns the scores into probabilities, draws one token, and feeds it back in.', 'It\'s the slot machine at the very end of the line.'],
  };
  const FLAVOR_HINTS = {
    attention: {
      mha: ['Check this model\'s K/V heads: does it have fewer of them than query heads?', 'It doesn\'t: all {heads} query heads have their own keys and values. No sharing.', 'Pick the original type, the one whose description says every head gets its own K and V.'],
      gqa: ['Check this model\'s K/V heads: does it have fewer of them than query heads?', 'Yes: {heads} query heads share just {kv} K/V heads, in groups.', 'Pick the type named after grouping the queries.'],
      mla: ['This model shrinks its KV cache, but not by having fewer heads.', 'It compresses K and V into one small vector before caching them.', 'Pick the type with "latent" in its name.'],
      sliding: ['Think about how far back this model\'s layers can look.', 'Most layers only see the last {window} tokens; only every 6th layer sees everything.', 'Pick the type that slides a short window along the text.'],
      alternating: ['Think about how far back this model\'s layers can look.', 'Its layers take turns: one only sees the last {window} tokens, the next sees everything.', 'Pick the type where the window alternates layer by layer.'],
    },
    norm: {
      layernorm: ['This is one of the older designs.', 'Its norm subtracts the average first, then divides by the spread.', 'Pick the original norm, named after the layer it normalizes.'],
      rmsnorm: ['This is a newer design that prefers cheaper parts.', 'Its norm skips the average and only divides by the root-mean-square.', 'Pick the norm whose name starts with the initials of "root mean square".'],
    },
    ffn: {
      gelu: ['This is one of the older designs, with a simple feed-forward.', 'There\'s no gate: just expand, activate, shrink.', 'Pick the type named after the activation alone, without "GLU".'],
      swiglu: ['This feed-forward has a gate that decides how much of each lane gets through.', 'The gate uses the SiLU activation, also called Swish.', 'Pick the type that combines Swish with GLU.'],
      geglu: ['This feed-forward has a gate that decides how much of each lane gets through.', 'The gate uses GELU, not SiLU.', 'Pick the type that combines GELU with GLU.'],
    },
    moe: {
      true: ['Ask: besides the experts the router picks, does every token also get one expert in common?', 'This model stores common knowledge once, in an expert that is always on duty.', 'So on top of the {active} routed experts, 1 more runs for every single token.'],
      false: ['Ask: besides the experts the router picks, does every token also get one expert in common?', 'Here the router picks every expert. Nothing is always on duty.', 'All {active} active experts are chosen per token, with none extra.'],
    },
  };
  const HOME = { tokenizer: 'input', embedding: 'input', posenc: 'input', lmhead: 'output', sampler: 'output' };
  const SUBLAYER = { attention: 1, ffn: 1, moe: 1 };
  const FIELDS = ['variant', 'heads', 'kvHeads', 'rope', 'qkNorm', 'window', 'windowShow', 'sinks', 'hidden', 'experts', 'active', 'shared', 'expertHidden'];
  const NUMBERS = ['heads', 'kvHeads', 'rope', 'qkNorm', 'window', 'windowShow', 'sinks', 'hidden', 'experts', 'active', 'expertHidden']; // copied from the blueprint once the right part is in a slot
  const VARIANTS = {
    attention: [
      ['mha', 'MHA', 'Every query head gets its own keys and values. Simple, but the KV cache is big. (GPT-2, OLMo 2)'],
      ['gqa', 'GQA', 'Groups of query heads share one K/V head: nearly the same quality, a much smaller cache. (Llama 3, Qwen3)'],
      ['mla', 'MLA', 'Squeezes K and V into a small latent vector before caching. Tiny cache. (DeepSeek V3, Kimi K2)'],
      ['sliding', 'SLIDING', 'Most layers only look back a short window; every 6th layer sees everything. (Gemma 3)'],
      ['alternating', 'ALT WINDOW', 'Every other layer uses a short window, the rest see everything. (gpt-oss)'],
    ],
    norm: [
      ['layernorm', 'LAYERNORM', 'Subtracts the mean, divides by the spread, then scales. The original. (GPT-2)'],
      ['rmsnorm', 'RMSNORM', 'Skips the mean and just divides by the root-mean-square. Cheaper, and now the standard.'],
    ],
    ffn: [
      ['gelu', 'GELU', 'Two matrices with a GELU in between: expand, activate, shrink. (GPT-2)'],
      ['swiglu', 'SWIGLU', 'Gated: a third matrix decides how much of each lane gets through, using SiLU. (Llama, Qwen)'],
      ['geglu', 'GEGLU', 'The same gate idea, with GELU instead of SiLU. (Gemma)'],
    ],
  };
  const ATT_NAMES = { mha: 'Multi-Head Attention', gqa: 'Grouped-Query Attention', mqa: 'Multi-Query Attention', mla: 'Multi-Head Latent Attention', sliding: 'Sliding Window Attention', alternating: 'Alternating Window Attention' };
  const STEPS = {
    vocab: [32000, 50257, 100278, 128256, 151936, 163840, 201088, 262144],
    d: [256, 512, 768, 1024, 2048, 2880, 4096, 5120, 5376, 7168, 8192, 12288],
    heads: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128],
    kvHeads: [1, 2, 4, 8, 16, 32, 64, 128],
    window: [128, 256, 512, 1024, 2048, 4096],
    experts: [8, 16, 32, 64, 128, 160, 256, 384, 512],
    active: [1, 2, 4, 6, 8, 10, 16],
    expertHidden: [256, 512, 768, 1024, 1408, 1536, 2048, 2880, 4096],
    repeat: [1, 2, 3, 4, 6, 8, 12, 16, 24, 28, 32, 36, 40, 48, 58, 60, 61, 62, 64, 80, 94, 96, 120, 128],
  };
  const EXPERT_H = { 'qwen3-235b-a22b': 1536, 'deepseek-v3': 2048, 'kimi-k2': 2048, 'gpt-oss-120b': 2880 }; // expert widths the cartridges don't store
  const r128 = (n) => Math.max(128, Math.round(n / 128) * 128);
  const title = (k) => (KINDS[k] || KINDS.custom).title.toUpperCase();

  let U = 0;
  function defaults(kind, d) {
    if (kind === 'attention') return { variant: 'gqa', heads: 32, kvHeads: 8, rope: true, qkNorm: false, window: 1024 };
    if (kind === 'norm') return { variant: 'rmsnorm' };
    if (kind === 'ffn') return { variant: 'swiglu', hidden: r128(d * 3.5) };
    if (kind === 'moe') return { experts: 64, active: 8, shared: false, expertHidden: r128(d * 0.375) };
    return {};
  }
  const mk = (kind, d) => Object.assign({ uid: 'u' + ++U, kind }, defaults(kind, d));

  // ------------------------------------------------------------ cartridge <-> build
  const usable = (m) => m.pieces.every((p) => PARTS.includes(p.kind));
  function family(m) {
    if (m.pieces.some((p) => p.kind === 'posenc')) return 'classic';
    if (m.pieces.some((p) => p.kind === 'moe')) return 'moe';
    return 'modern';
  }
  const FAMILIES = {
    classic: { name: 'CLASSIC DENSE', desc: 'The 2019 recipe: a learned position table, LayerNorm and a plain GELU feed-forward. Every weight works on every token.' },
    modern: { name: 'MODERN DENSE', desc: 'Same skeleton, upgraded parts: RoPE instead of a position table, RMSNorm, gated feed-forwards, and shared K/V heads to shrink the cache.' },
    moe: { name: 'MIXTURE OF EXPERTS', desc: 'Swap the feed-forward for a crowd of experts and a router. Huge total size, but each token only pays for a few experts.' },
  };
  function difficulty(m) {
    const b = fromModel(m), f = features(b);
    return clamp(1 + (f.ffn === 'moe' ? 1 : 0) + (f.multi ? 1 : 0) + (f.place !== 'pre' ? 1 : 0), 1, 3);
  }
  function fromModel(m) {
    const zones = [];
    m.sections.forEach((sec) => {
      const z = sec.block ? { type: 'block', repeat: sec.block.repeat || 1, label: sec.block.label || 'TRANSFORMER BLOCK', pieces: [] } : { type: sec.key === 'pre' ? 'input' : 'output', pieces: [] };
      sec.pieces.forEach((p) => {
        const q = { uid: 'u' + ++U, kind: p.kind };
        FIELDS.forEach((k) => { if (p[k] != null) q[k] = p[k]; });
        if (q.variant === 'mqa') q.variant = 'gqa';
        if (p.kind === 'attention' && q.kvHeads == null && q.variant !== 'mla') q.kvHeads = q.heads;
        if (p.kind === 'moe' && !q.expertHidden) q.expertHidden = EXPERT_H[m.id] || r128(m.d * 0.375);
        if (p.kind === 'moe') q.shared = !!q.shared;
        z.pieces.push(q);
      });
      zones.push(z);
    });
    if (!zones.length || zones[0].type !== 'input') zones.unshift({ type: 'input', pieces: [] });
    if (zones[zones.length - 1].type !== 'output') zones.push({ type: 'output', pieces: [] });
    return { d: m.d, vocab: m.vocab, zones };
  }
  function pieceName(q, z) {
    if (q.kind === 'attention') return ATT_NAMES[q.variant] || 'Attention';
    if (q.kind === 'norm') return (z.type === 'output' ? 'Final ' : '') + (q.variant === 'layernorm' ? 'LayerNorm' : 'RMSNorm');
    if (q.kind === 'ffn') return `Feed-Forward (${String(q.variant || 'gelu').toUpperCase()})`;
    if (q.kind === 'moe') return `MoE (${q.experts} experts)`;
    return KINDS[q.kind].title;
  }
  function factsOf(q, b) {
    if (q.kind === 'tokenizer') return [['Vocabulary', num(b.vocab) + ' tokens']];
    if (q.kind === 'embedding') return [['Vector width (d)', num(b.d)], ['Table size', `${num(b.vocab)} x ${num(b.d)}`]];
    if (q.kind === 'attention') return [['Query heads', num(q.heads)], ['K/V heads', q.variant === 'mla' ? 'compressed latent' : num(q.variant === 'mha' ? q.heads : q.kvHeads)], ['RoPE', q.rope ? 'yes' : 'no'], ['QK-norm', q.qkNorm ? 'yes' : 'no']].concat(q.variant === 'sliding' || q.variant === 'alternating' ? [['Window', num(q.window) + ' tokens']] : []);
    if (q.kind === 'ffn') return [['Hidden size', num(q.hidden)], ['Expansion', 'x' + (q.hidden / b.d).toFixed(1)]];
    if (q.kind === 'moe') return [['Experts', num(q.experts)], ['Active per token', num(q.active) + (q.shared ? ' + 1 shared' : '')], ['Expert hidden size', num(q.expertHidden)]];
    return [];
  }
  function toModel(b, name) {
    const m = { id: 'workshop', name, maker: 'You', year: '', d: b.d, vocab: b.vocab, blocks: [], pieces: [], quiz: [] };
    const cnt = {}; let bk = 0;
    b.zones.forEach((z) => {
      let blockId = null;
      if (z.type === 'block') { blockId = 'blk' + ++bk; m.blocks.push({ id: blockId, repeat: z.repeat, label: z.label || 'TRANSFORMER BLOCK' }); }
      let start = null; // first piece of the current sub-layer: where its skip connection branches off
      z.pieces.forEach((q) => {
        cnt[q.kind] = (cnt[q.kind] || 0) + 1;
        const p = { id: q.kind + cnt[q.kind], kind: q.kind, uid: q.uid, name: pieceName(q, z), facts: factsOf(q, b) };
        FIELDS.forEach((k) => { if (q[k] != null) p[k] = q[k]; });
        if (q.kind === 'attention' && q.variant === 'mha') p.kvHeads = q.heads;
        if (q.kind === 'attention' && q.variant === 'mla') delete p.kvHeads;
        if (blockId) p.block = blockId;
        if (q.kind === 'add') { if (start) p.residualFrom = start; start = null; } else if (!start) start = p.id;
        m.pieces.push(p);
      });
    });
    return m;
  }

  // ------------------------------------------------------------ meters (rough, order-of-magnitude estimates)
  function estimate(b) {
    const d = b.d, V = b.vocab, CTX = 131072, all = b.zones.flatMap((z) => z.pieces);
    let P = 0, A = 0, kv = 0, layers = 0;
    const once = (all.some((q) => q.kind === 'embedding') ? V * d : 0) + (all.some((q) => q.kind === 'lmhead') ? V * d : 0) + (all.some((q) => q.kind === 'posenc') ? 2048 * d : 0);
    P += once; A += once;
    b.zones.forEach((z) => {
      if (z.type !== 'block') return;
      const L = z.repeat || 1; layers += L;
      let p = 0, a = 0, cache = 0;
      z.pieces.forEach((q) => {
        if (q.kind === 'attention') {
          const H = q.heads || 32, hd = d / H; let ap, perTok;
          if (q.variant === 'mla') { ap = d * 1536 + 1536 * H * 192 + d * 576 + 512 * H * 256 + H * 128 * d; perTok = 576 * 2; }
          else { const kvh = q.variant === 'mha' ? H : Math.min(q.kvHeads || H, H); ap = 2 * d * d + 2 * d * kvh * hd; perTok = 2 * kvh * hd * 2; }
          const w = Math.min(q.window || 1024, CTX);
          const toks = q.variant === 'sliding' ? (5 / 6) * w + CTX / 6 : q.variant === 'alternating' ? 0.5 * w + 0.5 * CTX : CTX;
          p += ap; a += ap; cache += perTok * toks;
        }
        if (q.kind === 'ffn') { const f = (q.variant === 'gelu' ? 2 : 3) * d * (q.hidden || 4 * d); p += f; a += f; }
        if (q.kind === 'moe') {
          const e = 3 * d * (q.expertHidden || r128(d * 0.375)), router = d * q.experts, sh = q.shared ? e : 0;
          p += q.experts * e + router + sh; a += Math.min(q.active, q.experts) * e + router + sh;
        }
      });
      P += p * L; A += a * L; kv += cache * L;
    });
    return { params: P, active: A, kv, layers, d };
  }
  const big = (n) => (n >= 1e12 ? (n / 1e12).toFixed(n >= 1e13 ? 0 : 1) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(n >= 1e11 ? 0 : 1) + 'B' : n >= 1e6 ? Math.round(n / 1e6) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n)));
  const bytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(n >= 1e11 ? 0 : 1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB');

  // ------------------------------------------------------------ "looks like" detector
  function features(b) {
    const all = b.zones.flatMap((z) => z.pieces), blocks = b.zones.filter((z) => z.type === 'block' && z.pieces.length);
    const last = blocks[blocks.length - 1], ps = last ? last.pieces : [];
    const ai = ps.findIndex((q) => q.kind === 'attention'), att = ps[ai];
    let before = false, after = false;
    if (ai >= 0) {
      for (let i = ai - 1; i >= 0 && ps[i].kind !== 'add'; i--) if (ps[i].kind === 'norm') before = true;
      for (let i = ai + 1; i < ps.length && ps[i].kind !== 'add'; i++) if (ps[i].kind === 'norm') after = true;
    }
    const moe = all.find((q) => q.kind === 'moe'), ffn = all.find((q) => q.kind === 'ffn'), norm = ps.find((q) => q.kind === 'norm');
    return {
      posenc: all.some((q) => q.kind === 'posenc'),
      norm: norm ? norm.variant : 'none',
      place: before && after ? 'sandwich' : after ? 'post' : before ? 'pre' : 'none',
      attn: att ? att.variant : 'none',
      qk: !!(att && att.qkNorm),
      ffn: moe ? 'moe' : ffn ? (ffn.variant === 'gelu' ? 'gelu' : 'gated') : 'none',
      shared: !!(moe && moe.shared),
      multi: blocks.length > 1,
    };
  }
  const WEIGHT = { posenc: 1, norm: 1, place: 1.5, attn: 2, qk: 0.5, ffn: 2, shared: 1, multi: 1 };
  const NORMNAME = { rmsnorm: 'RMSNorm', layernorm: 'LayerNorm' };
  function diffText(k, t, n) {
    if (k === 'posenc') return t.posenc ? `${n} adds a POSITION EMBEDDING table` : `${n} has no position table (RoPE does that job)`;
    if (k === 'norm') return t.norm === 'none' ? `${n} has no norms` : `${n} uses ${NORMNAME[t.norm]}`;
    if (k === 'place') return { pre: `${n} puts a norm before each sub-layer`, post: `${n} puts its norms after each sub-layer`, sandwich: `${n} puts norms before and after each sub-layer`, none: `${n} has no norms in the block` }[t.place];
    if (k === 'attn') return `${n} uses ${ATT_NAMES[t.attn] || 'no attention'}`;
    if (k === 'qk') return t.qk ? `${n} turns on QK-norm` : `${n} has no QK-norm`;
    if (k === 'ffn') return { moe: `${n} uses a MIXTURE OF EXPERTS`, gelu: `${n} uses a plain GELU feed-forward`, gated: `${n} uses a gated (SwiGLU/GEGLU) feed-forward`, none: '' }[t.ffn];
    if (k === 'shared') return t.shared ? `${n} keeps a shared expert` : `${n} has no shared expert`;
    if (k === 'multi') return t.multi ? `${n} starts with dense blocks, then switches to MoE blocks` : `${n} uses a single block type`;
    return '';
  }
  let LIB = null;
  function lookalike(b) {
    LIB = LIB || MODELS.filter(usable).map((m) => { const mb = fromModel(m); return { m, f: features(mb), size: estimate(mb).params }; });
    const f = features(b), size = estimate(b).params; let best = null;
    LIB.forEach(({ m, f: t, size: ts }) => {
      let s = 0, tot = 0; const diffs = [];
      Object.keys(WEIGHT).forEach((k) => { tot += WEIGHT[k]; if (f[k] === t[k]) s += WEIGHT[k]; else diffs.push([WEIGHT[k], diffText(k, t, m.name)]); });
      // structure decides; overall size only breaks ties (Kimi K2 is DeepSeek V3's layout at a bigger size)
      const sizeSim = size && ts ? 1 - Math.min(1, Math.abs(Math.log10(size / ts))) : 0;
      const r = { m, score: 0.95 * (s / tot) + 0.05 * sizeSim, diffs: diffs.sort((a, c) => c[0] - a[0]).map((x) => x[1]).filter(Boolean) };
      if (!best || r.score > best.score) best = r;
    });
    return best;
  }

  // ------------------------------------------------------------ the foreman: wiring rules for free build
  const zoneName = (b, z) => (z.type === 'block' ? 'BLOCK ' + 'ABC'[b.zones.filter((x) => x.type === 'block').indexOf(z)] : z.type.toUpperCase());
  function check(b) {
    const iss = [], E = (msg, uid) => iss.push({ lvl: 'err', msg, uid }), Wn = (msg, uid) => iss.push({ lvl: 'warn', msg, uid });
    const all = b.zones.flatMap((z) => z.pieces.map((q) => ({ q, z })));
    if (!all.length) { E('Empty lot! Start in INPUT: drop in the part that turns raw text into ID numbers (the TOKENIZER).'); return iss; }
    all.forEach(({ q, z }) => {
      const home = HOME[q.kind];
      if (home && z.type !== home) E(`The ${title(q.kind)} belongs in ${home.toUpperCase()}: ${home === 'input' ? 'it runs once on the way in, not in every layer.' : 'it runs once at the very end, after all the layers.'}`, q.uid);
    });
    const ix = (x) => all.indexOf(x);
    const tok = all.filter((x) => x.q.kind === 'tokenizer'), emb = all.find((x) => x.q.kind === 'embedding');
    if (!tok.length) E('No TOKENIZER: raw text can\'t get in. Put one first in INPUT.');
    else if (all[0].q.kind !== 'tokenizer') E('The TOKENIZER has to come first: every other part works on token IDs, not letters.', tok[0].q.uid);
    if (tok.length > 1) Wn('Two tokenizers? Text only needs chopping once.', tok[1].q.uid);
    if (!emb) E('No TOKEN EMBEDDING: an ID number is just a label. The embedding swaps it for a vector the layers can work with.');
    else all.forEach((x) => { if (ix(x) < ix(emb) && x.q.kind !== 'tokenizer') E(`The ${title(x.q.kind)} needs vectors, not ID numbers: move it after the EMBEDDING.`, x.q.uid); });
    const filled = b.zones.filter((z) => z.type === 'block' && z.pieces.length);
    if (!filled.length) E('The BLOCK room is empty, and that\'s where the thinking happens. Add an ATTENTION and a FEED-FORWARD to it.');
    filled.forEach((z) => {
      const ks = z.pieces.map((q) => q.kind);
      if (!ks.includes('attention')) E(`${zoneName(b, z)} has no ATTENTION, so tokens never share information. Each word would be guessed alone.`);
      if (!ks.includes('ffn') && !ks.includes('moe')) E(`${zoneName(b, z)} has no FEED-FORWARD or MoE: attention gathers context, but nothing processes it.`);
    });
    const head = all.find((x) => x.q.kind === 'lmhead'), smp = all.find((x) => x.q.kind === 'sampler');
    if (!head) E('No LM HEAD: the final vector never gets turned into a score for each word. Put one in OUTPUT.');
    if (!smp) E('No SAMPLER: the model scores every word but never picks one. Put it last in OUTPUT.');
    if (smp && all[all.length - 1] !== smp) E('The SAMPLER must be the very last part: once a word is picked, the trip is over.', smp.q.uid);
    if (head && smp && ix(head) > ix(smp)) E('The LM HEAD has to score the words before the SAMPLER can pick one.', head.q.uid);
    all.forEach(({ q }) => {
      if (q.kind === 'attention' && q.variant !== 'mla' && q.variant !== 'mha') {
        if (q.kvHeads > q.heads) E('More K/V heads than query heads? Each K/V head is shared by a group of query heads, so there can\'t be more of them.', q.uid);
        else if (q.heads % q.kvHeads) E(`${q.heads} query heads can't split evenly into ${q.kvHeads} K/V groups.`, q.uid);
      }
      if (q.kind === 'moe' && q.active > q.experts) E(`The router can't pick ${q.active} experts out of ${q.experts}.`, q.uid);
    });
    filled.forEach((z) => {
      let pending = null;
      const noSkip = (q) => Wn(`No skip connection around the ${title(q.kind)}: add a + after it. Without skips, deep stacks lose the signal and stop learning.`, q.uid);
      z.pieces.forEach((q) => {
        if (SUBLAYER[q.kind]) { if (pending) noSkip(pending); pending = q; }
        else if (q.kind === 'add') { if (!pending) Wn('This + has nothing to skip around: put it after an ATTENTION or FEED-FORWARD.', q.uid); pending = null; }
      });
      if (pending) noSkip(pending);
      if (!z.pieces.some((q) => q.kind === 'norm')) Wn(`${zoneName(b, z)} has no NORM. As layers stack up, the numbers drift out of range. Add a NORM before the attention.`);
    });
    const hasPos = all.some((x) => x.q.kind === 'posenc'), rope = all.some((x) => x.q.kind === 'attention' && x.q.rope);
    if (filled.length && !hasPos && !rope) Wn('No position info anywhere: the model can\'t tell "dog bites man" from "man bites dog". Add a POSITION EMBEDDING, or switch on RoPE in the attention.');
    if (hasPos && rope) Wn('Position info twice: a POSITION EMBEDDING and RoPE. Real models pick one (GPT-2 the table, Llama RoPE).');
    const outZ = b.zones.find((z) => z.type === 'output');
    if (filled.length && head && outZ && !outZ.pieces.some((q) => q.kind === 'norm')) Wn('Every cartridge adds one last NORM in OUTPUT before the LM HEAD, to tidy the vector after the final layer.');
    return iss.filter((x) => x.lvl === 'err').concat(iss.filter((x) => x.lvl === 'warn'));
  }
  function tip(b, e) {
    const all = b.zones.flatMap((z) => z.pieces), att = all.find((q) => q.kind === 'attention');
    if (!all.some((q) => q.kind === 'moe')) return 'It works! Now try this: swap the FEED-FORWARD for a MIXTURE OF EXPERTS and watch TOTAL and ACTIVE split apart.';
    if (att && att.variant === 'mha') return 'It works! Switch the attention to GQA or MLA and watch the KV CACHE meter drop.';
    if (e.kv > 8e9 && att && !['mla', 'sliding', 'alternating'].includes(att.variant)) return 'It works, but that KV cache is hungry. MLA or SLIDING attention would shrink it a lot.';
    return 'It works! Press TEST RUN to send a token through your machine, or open CHALLENGES for a goal.';
  }
  const CHALLENGES = [
    { id: 'tiny', name: 'TINY TITAN', goal: 'Under 1B parameters, with at least 12 layers.', test: (e) => e.params < 1e9 && e.layers >= 12 },
    { id: 'diet', name: 'CACHE DIET', goal: 'At least 32 layers and width 4,096+, with a KV cache under 4 GB at 128K tokens.', test: (e) => e.layers >= 32 && e.d >= 4096 && e.kv < 4e9 },
    { id: 'cheap', name: 'BIG BRAIN, SMALL BILL', goal: 'Over 100B parameters in total, but under 20B active per token.', test: (e) => e.params >= 1e11 && e.active <= 2e10 },
    { id: 'orig', name: 'ORIGINAL ARCHITECT', goal: 'A working model with no warnings that is less than 70% like any cartridge.', test: (e, c) => c.clean && c.best && c.best.score < 0.7 },
  ];

  // ------------------------------------------------------------ blueprint checking
  function keyField(kind) { return kind === 'moe' ? 'shared' : VARIANTS[kind] ? 'variant' : null; }
  function bpEval() {
    const zs = st.build.zones.map((z, zi) => {
      const T = st.target.zones[zi].pieces;
      const status = z.pieces.map((q, i) => {
        if (i >= T.length) return 'extra';
        if (q.kind !== T[i].kind) return 'wrong';
        const f = keyField(q.kind);
        return f && String(q[f]) !== String(T[i][f]) ? 'flavor' : 'ok';
      });
      return { status, ghosts: Math.max(0, T.length - z.pieces.length) };
    });
    const total = st.target.zones.reduce((n, z) => n + z.pieces.length, 0);
    const right = zs.reduce((n, z) => n + z.status.filter((s) => s === 'ok').length, 0);
    return { zs, total, right, complete: right === total && zs.every((z) => z.status.length === z.status.filter((s) => s === 'ok').length && !z.ghosts) };
  }
  function bpSync() { // once the right part is in a slot, it takes the blueprint's numbers (the lesson is which part and which type)
    st.build.zones.forEach((z, zi) => z.pieces.forEach((q, i) => {
      const t = st.target.zones[zi].pieces[i];
      if (t && t.kind === q.kind) NUMBERS.forEach((k) => { if (t[k] != null) q[k] = t[k]; else delete q[k]; });
    }));
  }
  function bpProblem(ev) {
    for (let zi = 0; zi < ev.zs.length; zi++) {
      const i = ev.zs[zi].status.findIndex((s) => s !== 'ok');
      if (i >= 0) return { zi, i, s: ev.zs[zi].status[i] };
    }
    for (let zi = 0; zi < ev.zs.length; zi++) if (ev.zs[zi].ghosts) return { zi, i: st.build.zones[zi].pieces.length, s: 'ghost' };
    return null;
  }
  function bpForeman(ev) {
    const n = st.bpModel.name, pr = bpProblem(ev);
    if (!pr) return { tone: 'ok', text: `Blueprint complete: that's ${n}, part for part! Press TEST RUN to send a token through it.` };
    const z = st.build.zones[pr.zi], zn = zoneName(st.build, z), t = st.target.zones[pr.zi].pieces[pr.i], q = z.pieces[pr.i];
    const slot = `${zn}, slot ${pr.i + 1}`;
    if (pr.s === 'extra') return { tone: 'err', text: `${zn} has one part too many for ${n}. Remove the ${title(q.kind)} (drag it back to the bin, or select it and press REMOVE).`, uid: q.uid };
    if (pr.s === 'wrong') {
      const nowhere = !st.target.zones.some((tz) => tz.pieces.some((x) => x.kind === q.kind));
      const extra = nowhere ? (q.kind === 'posenc' ? ` ${n} has no position table at all: position comes from RoPE inside the attention.` : ` ${n} doesn't use a ${title(q.kind)} anywhere.`) : '';
      return { tone: 'err', text: `${slot}: that's a ${title(q.kind)}, but this slot's job is: "${JOB[t.kind]}"${extra}`, uid: q.uid };
    }
    if (pr.s === 'flavor') {
      const f = keyField(q.kind);
      return { tone: 'warn', text: `${slot}: right part! But ${n} uses a different type of ${title(q.kind)}. Select it and change its ${f === 'shared' ? 'SHARED EXPERT switch' : 'TYPE'}, or press HINT.`, uid: q.uid };
    }
    return { tone: 'info', text: `Next: ${slot}. Its job: "${JOB[t.kind]}" Which part from the bin does that?` };
  }
  // hints belong to one problem at one slot; fixing it (or moving on) starts a fresh ladder
  const hintKey = (pr) => `${pr.zi}:${pr.i}:${pr.s === 'ghost' || pr.s === 'wrong' ? 'part' : pr.s}`;
  function ladder(pr) {
    const t = st.target.zones[pr.zi].pieces[pr.i], q = st.build.zones[pr.zi].pieces[pr.i];
    const fill = (x) => x.replace(/\{(\w+)\}/g, (_, k) => num({ heads: t.heads, kv: t.kvHeads, window: t.window, active: t.active }[k]));
    if (pr.s === 'extra') return {
      nudges: [`Count this room's parts against the blueprint: one of them doesn't belong in ${st.bpModel.name}.`, 'Look for the part marked with a red "!" near the end of the room.', 'Every part before it is right. This one is surplus, so the fix is to take something away.'],
      answer: `Remove the ${title(q.kind)} (drag it to the bin, or select it and press REMOVE).`,
    };
    if (pr.s === 'flavor') {
      const f = keyField(t.kind), v = String(t[f]);
      return {
        nudges: ((FLAVOR_HINTS[t.kind] || {})[v] || ['Compare this part with the same part in the cartridge.', 'Read the description under each TYPE option.', 'Only one option matches this model.']).map(fill),
        answer: f === 'shared' ? `Turn the SHARED EXPERT switch ${t.shared ? 'ON' : 'OFF'}.` : `Set its TYPE to ${VARIANTS[t.kind].find((x) => x[0] === t[f])[1]}.`,
      };
    }
    return { nudges: HINTS[t.kind], answer: `It's the ${title(t.kind)}.${pr.s === 'wrong' ? ' Swap out the part that is there now.' : ''}` };
  }
  function hintLine(pr) {
    const lv = st.hintLv[hintKey(pr)] || 0; if (!lv) return '';
    const L = ladder(pr);
    return lv > 3 ? 'ANSWER: ' + L.answer : `HINT ${lv}/3: ${L.nudges[lv - 1]}`;
  }

  // ------------------------------------------------------------ state
  let st = null;
  const panel = el('div', 'pbox'); panel.id = 'workshop'; panel.hidden = true; document.body.appendChild(panel);
  const wsave = () => (api.save.workshop = api.save.workshop || { bp: {}, ch: {} });

  function enter() {
    $('#title').hidden = true; $('#hud').hidden = false; $('#modal').hidden = true; $('#inspector').hidden = true;
    document.body.classList.add('ws', 'ws-build'); document.body.classList.remove('ws-run');
    panel.hidden = false;
    $('#cart-name').innerHTML = `WORKSHOP<small>${st.mode === 'bp' ? 'BLUEPRINT: ' + esc(st.bpModel.name) : 'FREE BUILD'}</small>`;
    api.renderStats(); sfx.start();
    render(); rebuild3D(true);
  }
  function startBlueprint(m) {
    const target = fromModel(m);
    st = {
      mode: 'bp', bpModel: m, target, undo: [], sel: null, zone: 0, nudges: 0, answers: 0, hintLv: {}, mistakes: 0, revealed: new Set(), done: false, view: 'build', u2o: {},
      build: { d: target.d, vocab: target.vocab, zones: target.zones.map((z) => ({ type: z.type, repeat: z.repeat, label: z.label, pieces: [] })) },
    };
    enter();
  }
  function startFree(build) {
    st = { mode: 'free', build, undo: [], sel: null, zone: 0, view: 'build', u2o: {}, showCh: false };
    enter();
  }
  function close() {
    if (!st) return;
    st = null; panel.hidden = true;
    document.body.classList.remove('ws', 'ws-build', 'ws-run');
    api.setInset(0, 0);
  }

  // ------------------------------------------------------------ 3D
  function rebuild3D(first) {
    const name = st.mode === 'bp' ? st.bpModel.name + ' (your build)' : 'Your LLM';
    const m = toModel(st.build, name);
    st.u2o = {};
    if (!m.pieces.length) { api.clearWorld(); return; }
    api.prepModel(m);
    api.buildWorld(m, { keepCam: !first });
    api.world().pieces.forEach((o) => (st.u2o[o.p.uid] = o));
    markSel();
    if (st.flashU && st.u2o[st.flashU]) st.u2o[st.flashU].flash = 1;
    st.flashU = null;
  }
  function markSel() {
    const w = api.world(); if (!w) return;
    if (w.selected) w.selected.label.classList.remove('sel');
    const o = st.sel ? st.u2o[st.sel] : null;
    w.selected = o || null;
    if (o) o.label.classList.add('sel');
  }
  function syncInset() {
    if (!st || st.view !== 'build' || panel.hidden) { api.setInset(0, 0); return; }
    const r = panel.getBoundingClientRect();
    if (window.innerWidth >= 820) api.setInset(r.right + 12, 0); else api.setInset(0, window.innerHeight - r.top + 8);
  }
  window.addEventListener('resize', () => { if (st) syncInset(); });

  // ------------------------------------------------------------ editing
  const find = (uid) => { for (let zi = 0; zi < st.build.zones.length; zi++) { const i = st.build.zones[zi].pieces.findIndex((q) => q.uid === uid); if (i >= 0) return { zi, i, q: st.build.zones[zi].pieces[i] }; } return null; };
  function change(fn) {
    st.undo.push(JSON.stringify(st.build)); if (st.undo.length > 40) st.undo.shift();
    const before = st.mode === 'bp' ? bpEval() : null;
    fn();
    after(before);
  }
  function after(before) {
    if (st.mode === 'bp') {
      bpSync();
      const ev = bpEval();
      if (before && ev.right > before.right) sfx.coin();
      if (ev.complete && !st.done) finishBlueprint();
    } else {
      wsave().last = st.build; api.persist();
      checkChallenges();
    }
    render(); rebuild3D(false);
  }
  function addPart(kind, zi, at) {
    const zone = st.build.zones[zi]; if (!zone) return;
    const q = mk(kind, st.build.d);
    change(() => { zone.pieces.splice(at == null ? zone.pieces.length : at, 0, q); st.sel = q.uid; st.zone = zi; st.flashU = q.uid; });
    sfx.select();
    if (st.mode === 'bp') {
      const f = find(q.uid), s = bpEval().zs[f.zi].status[f.i];
      if (s === 'wrong' || s === 'extra') { st.mistakes++; sfx.wrong(); shake(); }
      else if (s === 'ok') { st.sel = null; render(); markSel(); } // move on: the next bin click fills the next glowing slot
    }
  }
  function insertAt(zi) { // after the selected chip if it's in this zone, else at the end
    const f = st.sel && find(st.sel);
    return f && f.zi === zi ? f.i + 1 : st.build.zones[zi].pieces.length;
  }
  function movePiece(uid, zi, at) {
    const f = find(uid); if (!f) return;
    change(() => {
      st.build.zones[f.zi].pieces.splice(f.i, 1);
      if (f.zi === zi && at > f.i) at--;
      st.build.zones[zi].pieces.splice(clamp(at, 0, st.build.zones[zi].pieces.length), 0, f.q);
      st.sel = uid; st.zone = zi; st.flashU = uid;
    });
    sfx.tick();
  }
  function nudge(uid, dir) {
    const f = find(uid); if (!f) return;
    const z = st.build.zones[f.zi];
    if (f.i + dir >= 0 && f.i + dir < z.pieces.length) return movePiece(uid, f.zi, f.i + dir + (dir > 0 ? 1 : 0));
    const nz = f.zi + dir; if (nz < 0 || nz >= st.build.zones.length) return;
    movePiece(uid, nz, dir > 0 ? 0 : st.build.zones[nz].pieces.length);
  }
  function removePiece(uid) {
    const f = find(uid); if (!f) return;
    change(() => { st.build.zones[f.zi].pieces.splice(f.i, 1); if (st.sel === uid) st.sel = null; });
    sfx.tick();
  }
  function stepList(field, cur) {
    if (field === 'hidden') { const d = st.build.d; return [...new Set([2, 2.67, 3.5, 4, 5.25].map((x) => r128(d * x)).concat(cur))].sort((a, b) => a - b); }
    return STEPS[field].includes(cur) ? STEPS[field] : STEPS[field].concat(cur).sort((a, b) => a - b);
  }
  function stepVal(field, cur, dir) { const L = stepList(field, cur); return L[clamp(L.indexOf(cur) + dir, 0, L.length - 1)]; }

  function shake() { const f = panel.querySelector('.ws-foreman'); if (f) { f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); } }

  // ------------------------------------------------------------ progress & rewards
  function finishBlueprint() {
    st.done = true;
    // nudges are cheap, answers are not: 3 stars allows a few nudges but no answers
    const stars = st.answers === 0 && st.nudges <= 3 && st.mistakes <= 1 ? 3 : st.answers <= 2 && st.mistakes <= 4 ? 2 : 1;
    const W = wsave(), prev = W.bp[st.bpModel.id] || 0;
    W.bp[st.bpModel.id] = Math.max(prev, stars); api.persist();
    sfx.levelup();
    if (!prev) { api.gainXP(80, 'BLUEPRINT COMPLETE!'); api.gainCoins(15); } else api.gainXP(20, 'BLUEPRINT COMPLETE!');
    const box = $('#modal'); box.hidden = false;
    box.innerHTML = `<div class="mbox pbox"><h2>BLUEPRINT COMPLETE!</h2>
      <div class="rank">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
      <p class="qtext" style="text-align:center">You rebuilt ${esc(st.bpModel.name)}.</p>
      <p style="text-align:center">${st.nudges} hint${st.nudges === 1 ? '' : 's'} · ${st.answers} answer${st.answers === 1 ? '' : 's'} shown · ${st.mistakes} wrong part${st.mistakes === 1 ? '' : 's'}. ${stars < 3 ? '3 stars: no answers shown, at most 3 hints and 1 wrong part.' : 'Flawless.'}</p>
      <div class="mfoot"><button class="pbtn" data-a="menu">WORKSHOP MENU</button><button class="pbtn" data-a="stay">KEEP LOOKING</button><button class="pbtn gold" data-a="run">&#9654; TEST RUN</button></div></div>`;
    box.onclick = (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      box.hidden = true;
      if (a.dataset.a === 'menu') openMenu(); if (a.dataset.a === 'run') testRun();
    };
  }
  function checkChallenges() {
    const e = estimate(st.build), iss = check(st.build), W = wsave();
    const c = { clean: !iss.length, best: lookalike(st.build) };
    if (iss.some((x) => x.lvl === 'err')) return;
    CHALLENGES.forEach((ch) => {
      if (W.ch[ch.id] || !ch.test(e, c)) return;
      W.ch[ch.id] = 1; api.persist();
      sfx.levelup(); api.gainXP(50, 'CHALLENGE: ' + ch.name); api.gainCoins(10);
      st.flashMsg = { tone: 'ok', text: `Challenge complete: ${ch.name}! ${ch.goal}` };
    });
  }

  // ------------------------------------------------------------ run your build
  function testRun() {
    if (st.mode === 'bp' && !bpEval().complete) { st.flashMsg = { tone: 'err', text: 'Finish the blueprint first: a half-built machine would jam on the first token.' }; render(); shake(); sfx.wrong(); return; }
    if (st.mode === 'free') {
      const err = check(st.build).find((x) => x.lvl === 'err');
      if (err) {
        st.flashMsg = { tone: 'err', text: 'The token fizzles! ' + err.msg, uid: err.uid };
        if (err.uid) { st.sel = err.uid; markSel(); if (st.u2o[err.uid]) st.u2o[err.uid].flash = 1; }
        render(); shake(); sfx.wrong(); return;
      }
    }
    st.view = 'run'; document.body.classList.remove('ws-build'); document.body.classList.add('ws-run');
    const w = api.world(); if (w && w.selected) { w.selected.label.classList.remove('sel'); w.selected = null; }
    api.setInset(0, 0); api.testRun();
  }
  function backToBuild() {
    if (!st) return;
    api.stopFlow(true); if (api.world()) api.select(null);
    st.view = 'build'; document.body.classList.add('ws-build'); document.body.classList.remove('ws-run');
    render(); markSel(); api.fitCamera(false, true);
  }
  $('#btn-build').onclick = backToBuild;

  // ------------------------------------------------------------ rendering
  function chipLabel(q) {
    if (q.kind === 'norm') return q.variant === 'layernorm' ? 'LAYERNORM' : 'RMSNORM';
    if (q.kind === 'attention') return { mha: 'MHA', gqa: 'GQA', mla: 'MLA', sliding: 'SLIDING', alternating: 'ALT WINDOW' }[q.variant] || 'ATTN';
    if (q.kind === 'ffn') return 'FFN ' + String(q.variant || 'gelu').toUpperCase();
    if (q.kind === 'moe') return `MOE ${q.experts}/${q.active}${q.shared ? '+1' : ''}`;
    if (q.kind === 'add') return '+ ADD';
    if (q.kind === 'posenc') return 'POSITION';
    return title(q.kind);
  }
  function foreman() {
    if (st.flashMsg) { const m = st.flashMsg; st.flashMsg = null; return m; }
    if (st.mode === 'bp') { const ev = bpEval(), m = bpForeman(ev), pr = bpProblem(ev); if (pr) m.hint = hintLine(pr); return m; }
    const iss = check(st.build);
    if (iss.length) return { tone: iss[0].lvl, text: iss[0].msg + (iss.length > 1 ? `  (${iss.length - 1} more note${iss.length > 2 ? 's' : ''})` : ''), uid: iss[0].uid };
    return { tone: 'ok', text: tip(st.build, estimate(st.build)) };
  }
  function render() {
    const b = st.build, bp = st.mode === 'bp';
    const ev = bp ? bpEval() : null, iss = bp ? [] : check(b);
    const errU = new Set(iss.filter((x) => x.lvl === 'err' && x.uid).map((x) => x.uid)), warnU = new Set(iss.filter((x) => x.lvl === 'warn' && x.uid).map((x) => x.uid));
    const fm = foreman();
    const nextGhost = bp ? bpProblem(ev) : null;
    if (bp && nextGhost && nextGhost.s === 'ghost' && !st.sel) st.zone = nextGhost.zi;
    const e = estimate(b);

    let meters = '';
    if (bp) {
      meters = `<div class="ws-prog"><div class="bar"><i style="width:${(100 * ev.right) / ev.total}%"></i></div><span>${ev.right}/${ev.total} SLOTS</span><span>HINTS ${st.nudges}</span><span>ANSWERS ${st.answers}</span><span>MISSES ${st.mistakes}</span></div>`;
    } else {
      const best = lookalike(b);
      meters = `<div class="ws-meters">
        <div><b>~${big(e.params)}</b><small>PARAMS</small></div><div><b>~${big(e.active)}</b><small>ACTIVE / TOKEN</small></div>
        <div><b>${e.kv ? '~' + bytes(e.kv) : '-'}</b><small>KV @ 128K</small></div><div><b>${e.layers}</b><small>LAYERS</small></div></div>
        ${best && b.zones.some((z) => z.pieces.length) ? `<div class="ws-like">LOOKS LIKE <b>${esc(best.m.name.toUpperCase())}</b> · ${Math.round(best.score * 100)}%${best.diffs.length ? `<small>To match it: ${esc(best.diffs.slice(0, 2).join('; '))}.</small>` : '<small>Same architecture family, part for part.</small>'}</div>` : ''}`;
    }

    const zones = b.zones.map((z, zi) => {
      const T = bp ? st.target.zones[zi].pieces : null;
      const chips = z.pieces.map((q, i) => {
        const s = bp ? ev.zs[zi].status[i] : errU.has(q.uid) ? 'err' : warnU.has(q.uid) ? 'warn' : '';
        const badge = s === 'ok' ? '&#10003;' : s === 'wrong' || s === 'extra' || s === 'err' ? '!' : s === 'flavor' || s === 'warn' ? '?' : '';
        return `<div class="chip ${s} ${st.sel === q.uid ? 'sel' : ''}" draggable="true" data-u="${q.uid}" style="--c:${KINDS[q.kind].color}" title="${esc(KINDS[q.kind].title)}"><i>${esc(KINDS[q.kind].icon)}</i>${esc(chipLabel(q))}${badge ? `<em>${badge}</em>` : ''}</div>`;
      }).join('');
      const ghosts = bp ? T.slice(z.pieces.length).map((t, k) => {
        const idx = z.pieces.length + k, shown = st.revealed.has(zi + ':' + idx), next = nextGhost && nextGhost.s === 'ghost' && nextGhost.zi === zi && k === 0;
        return `<div class="chip ghost ${next ? 'next' : ''}" title="${esc(JOB[t.kind])}" ${shown ? `style="--c:${KINDS[t.kind].color}"` : ''}><i>${shown ? esc(KINDS[t.kind].icon) : '?'}</i>${shown ? esc(title(t.kind)) : 'SLOT ' + (idx + 1)}</div>`;
      }).join('') : '';
      const isBlock = z.type === 'block';
      const head = isBlock
        ? `<span class="zn">${zoneName(b, z)}</span>${bp ? `<span class="rep">x${num(z.repeat)}</span>` : `<span class="stepper"><button data-a="zstep" data-z="${zi}" data-dir="-1">&lt;</button><span class="rep">x${num(z.repeat)}</span><button data-a="zstep" data-z="${zi}" data-dir="1">&gt;</button></span>`}<small>${isBlock ? 'stacked, runs every layer' : ''}</small>${!bp ? `<button class="zx" data-a="zrm" data-z="${zi}" title="Remove this block type">X</button>` : ''}`
        : `<span class="zn">${z.type.toUpperCase()}</span><small>${z.type === 'input' ? 'runs once, on the way in' : 'runs once, at the end'}</small>`;
      const empty = !z.pieces.length && !ghosts ? `<span class="hint">${isBlock ? 'Drop parts here: they repeat in every layer' : 'Drop parts here'}</span>` : '';
      return `<div class="zone ${isBlock ? 'block' : ''} ${st.zone === zi ? 'active' : ''}" data-z="${zi}"><div class="zh">${head}</div><div class="chips" data-z="${zi}">${chips}${ghosts}${empty}</div></div>`;
    }).join('');
    const addZone = !bp && b.zones.filter((z) => z.type === 'block').length < 3 ? '<button class="pbtn small ws-addz" data-a="zadd">+ ADD A BLOCK TYPE <span>(like DeepSeek: dense first, then MoE)</span></button>' : '';

    const f = st.sel && find(st.sel);
    const settings = f ? settingsHTML(f, bp) : `<div class="ws-set empty">${bp ? 'Pick a part from the bin for the glowing slot. Tap a placed part to change its type.' : 'Tap a part to tune it. Tap a bin part to add it to the highlighted room.'}</div>`;

    const bin = PARTS.map((k) => `<button class="part" draggable="true" data-a="add" data-k="${k}" style="--c:${KINDS[k].color}" title="${bp ? '' : esc(KINDS[k].blurb)}"><i>${esc(KINDS[k].icon)}</i>${esc(KINDS[k].title)}</button>`).join('');

    const W = wsave();
    const chList = !bp && st.showCh ? `<div class="ws-ch">${CHALLENGES.map((c) => `<div class="${W.ch[c.id] ? 'done' : ''}"><b>${W.ch[c.id] ? '&#10003; ' : ''}${esc(c.name)}</b>${esc(c.goal)}</div>`).join('')}</div>` : '';
    const nCh = CHALLENGES.filter((c) => W.ch[c.id]).length;

    panel.innerHTML = `
      <div class="ws-foreman ${fm.tone}"><div class="por">F</div><div><div class="nm">FOREMAN</div><div class="tx">${esc(fm.text)}</div>${fm.hint ? `<div class="hx">${esc(fm.hint)}</div>` : ''}</div></div>
      ${meters}
      <div class="ws-zones">${zones}${addZone}</div>
      ${settings}
      <div class="ws-bin"><div class="bh">PARTS BIN <small>tap to add · drag to place · drag here to remove</small></div><div class="parts">${bin}</div></div>
      ${chList}
      <div class="ws-foot">
        <button class="pbtn gold" data-a="run">&#9654; TEST RUN</button>
        ${bp ? hintButton(ev) : `<button class="pbtn ${st.showCh ? 'on' : ''}" data-a="ch">CHALLENGES ${nCh}/${CHALLENGES.length}</button>`}
        <button class="pbtn" data-a="undo" ${st.undo.length ? '' : 'disabled'}>UNDO</button>
        <button class="pbtn" data-a="menu">MENU</button>
      </div>`;
    syncInset();
  }
  function revealSettings() { const s = panel.querySelector('.ws-set'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  function hintButton(ev) {
    const pr = bpProblem(ev), lv = pr ? st.hintLv[hintKey(pr)] || 0 : 4;
    const label = !pr ? 'HINT' : lv >= 4 ? 'ANSWER SHOWN' : lv === 3 ? 'SHOW ANSWER' : `HINT ${lv + 1}/3`;
    return `<button class="pbtn" data-a="hint" ${lv >= 4 ? 'disabled' : ''}>${label}</button>`;
  }
  function settingsHTML(f, bp) {
    const q = f.q, z = st.build.zones[f.zi], K = KINDS[q.kind];
    const t = bp ? st.target.zones[f.zi].pieces[f.i] : null;
    const rows = [];
    const seg = (field, opts) => `<div class="row"><label>TYPE</label><div class="seg">${opts.map(([v, lab]) => `<button data-a="set" data-f="${field}" data-v="${v}" class="${q[field] === v ? 'on' : ''}">${lab}</button>`).join('')}</div></div>`;
    const stepper = (field, label, val, shown) => `<div class="row"><label>${label}</label><span class="stepper"><button data-a="step" data-f="${field}" data-dir="-1">&lt;</button><b>${shown != null ? shown : num(val)}</b><button data-a="step" data-f="${field}" data-dir="1">&gt;</button></span></div>`;
    const tog = (field, label, why) => `<div class="row"><label>${label}</label><button class="tog ${q[field] ? 'on' : ''}" data-a="tog" data-f="${field}">${q[field] ? 'ON' : 'OFF'}</button><small>${why}</small></div>`;
    const fact = (label, val) => `<div class="row"><label>${label}</label><b>${val}</b></div>`;
    if (VARIANTS[q.kind]) {
      rows.push(seg('variant', VARIANTS[q.kind]));
      const v = VARIANTS[q.kind].find((x) => x[0] === q.variant);
      if (v) rows.push(`<p class="vdesc">${esc(v[2])}</p>`);
    }
    if (q.kind === 'moe') rows.push(tog('shared', 'SHARED EXPERT', 'one expert every token always uses'));
    if (bp) {
      factsOf(q, st.build).forEach(([k, v]) => rows.push(fact(esc(k.toUpperCase()), esc(v))));
      if (t && t.kind === q.kind && q.kind !== 'add') rows.push('<p class="vdesc">Numbers come from the blueprint. Your job is the part and its type.</p>');
    } else {
      if (q.kind === 'tokenizer') rows.push(stepper('vocab', 'VOCAB', st.build.vocab), '<p class="vdesc">Bigger vocab: fewer tokens per sentence, but a bigger embedding table and LM head.</p>');
      if (q.kind === 'embedding') rows.push(stepper('d', 'WIDTH (d)', st.build.d), '<p class="vdesc">How many numbers describe each token. Every other part grows with it.</p>');
      if (q.kind === 'attention') {
        rows.push(stepper('heads', 'QUERY HEADS', q.heads));
        if (q.variant !== 'mha' && q.variant !== 'mla') rows.push(stepper('kvHeads', 'K/V HEADS', q.kvHeads));
        if (q.variant === 'sliding' || q.variant === 'alternating') rows.push(stepper('window', 'WINDOW', q.window, num(q.window) + ' tok'));
        rows.push(tog('rope', 'ROPE', 'rotates Q and K by position'), tog('qkNorm', 'QK-NORM', 'normalizes Q and K for stability'));
      }
      if (q.kind === 'ffn') rows.push(stepper('hidden', 'HIDDEN', q.hidden, `${num(q.hidden)} (x${(q.hidden / st.build.d).toFixed(1)})`));
      if (q.kind === 'moe') rows.push(stepper('experts', 'EXPERTS', q.experts), stepper('active', 'ACTIVE', q.active), stepper('expertHidden', 'EXPERT SIZE', q.expertHidden));
    }
    return `<div class="ws-set" style="--c:${K.color}">
      <div class="sh"><i>${esc(K.icon)}</i><div><small>${zoneName(st.build, z)} · SLOT ${f.i + 1}</small><b>${esc(pieceName(q, z).toUpperCase())}</b></div><button class="pbtn small" data-a="desel">X</button></div>
      <p class="job">${esc(K.blurb)}</p>
      ${rows.join('')}
      <div class="acts"><button class="pbtn small" data-a="mv" data-dir="-1">&lt; MOVE</button><button class="pbtn small" data-a="mv" data-dir="1">MOVE &gt;</button><button class="pbtn small red" data-a="rm">REMOVE</button></div>
    </div>`;
  }

  // ------------------------------------------------------------ input
  panel.addEventListener('click', (e) => {
    if (!st) return;
    const a = e.target.closest('[data-a]'), chip = e.target.closest('.chip:not(.ghost)'), zoneEl = e.target.closest('.zone');
    if (!a && chip) { st.sel = chip.dataset.u; st.zone = find(st.sel).zi; render(); markSel(); revealSettings(); const o = st.u2o[st.sel]; if (o) o.flash = 1; sfx.select(); return; }
    if (!a && zoneEl) { st.zone = +zoneEl.dataset.z; if (st.sel && find(st.sel).zi !== st.zone) { st.sel = null; markSel(); } render(); return; }
    if (!a || a.disabled) return;
    const act = a.dataset.a, f = st.sel && find(st.sel);
    if (act === 'add') {
      if (st.mode === 'bp') { // a tap always fills the next empty slot; dragging can still drop a part anywhere
        const zi = st.build.zones.findIndex((z, i) => z.pieces.length < st.target.zones[i].pieces.length);
        if (zi < 0) { st.flashMsg = { tone: 'warn', text: 'Every slot is filled. Fix the marked parts (select one to change its type, or drag it to the bin).' }; render(); shake(); sfx.wrong(); return; }
        addPart(a.dataset.k, zi, st.build.zones[zi].pieces.length);
      } else { const zi = clamp(st.zone, 0, st.build.zones.length - 1); addPart(a.dataset.k, zi, insertAt(zi)); }
    }
    if (act === 'set' && f) change(() => { f.q[a.dataset.f] = a.dataset.v; });
    if (act === 'tog' && f) change(() => { f.q[a.dataset.f] = !f.q[a.dataset.f]; });
    if (act === 'step') {
      const fld = a.dataset.f, dir = +a.dataset.dir;
      if (fld === 'vocab' || fld === 'd') change(() => {
        const old = st.build.d; st.build[fld] = stepVal(fld, st.build[fld], dir);
        if (fld === 'd') st.build.zones.forEach((z) => z.pieces.forEach((q) => { if (q.kind === 'ffn') q.hidden = r128((q.hidden / old) * st.build.d); }));
      });
      else if (f) change(() => { f.q[fld] = stepVal(fld, f.q[fld], dir); });
      sfx.tick();
    }
    if (act === 'zstep') { const z = st.build.zones[+a.dataset.z]; change(() => { z.repeat = stepVal('repeat', z.repeat, +a.dataset.dir); }); sfx.tick(); }
    if (act === 'zadd') change(() => { const at = st.build.zones.length - 1; st.build.zones.splice(at, 0, { type: 'block', repeat: 8, label: 'TRANSFORMER BLOCK', pieces: [] }); st.zone = at; st.sel = null; });
    if (act === 'zrm') { const zi = +a.dataset.z; change(() => { st.build.zones.splice(zi, 1); st.zone = 0; st.sel = null; }); }
    if (act === 'mv' && f) nudge(f.q.uid, +a.dataset.dir);
    if (act === 'rm' && f) removePiece(f.q.uid);
    if (act === 'desel') { st.sel = null; render(); markSel(); }
    if (act === 'undo' && st.undo.length) { st.build = JSON.parse(st.undo.pop()); st.sel = null; after(null); sfx.tick(); }
    if (act === 'hint') hint();
    if (act === 'ch') { st.showCh = !st.showCh; render(); }
    if (act === 'run') testRun();
    if (act === 'menu') openMenu();
  });
  function hint() {
    const pr = bpProblem(bpEval()); if (!pr) return;
    const key = hintKey(pr), lv = Math.min(4, (st.hintLv[key] || 0) + 1);
    st.hintLv[key] = lv;
    if (lv <= 3) st.nudges++;
    else { st.answers++; if (pr.s === 'ghost' || pr.s === 'wrong') st.revealed.add(pr.zi + ':' + pr.i); }
    sfx.tick(); render();
  }

  // drag and drop: bin parts and placed chips into rooms; chips back onto the bin to remove them
  let drag = null;
  function dropIndex(chipsEl, x, y) {
    const cs = [...chipsEl.querySelectorAll('.chip:not(.ghost)')];
    for (let i = 0; i < cs.length; i++) { const r = cs[i].getBoundingClientRect(); if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return i; }
    return cs.length;
  }
  function clearMarks() { panel.querySelectorAll('.drop-before,.drop-end,.drop-bin').forEach((n) => n.classList.remove('drop-before', 'drop-end', 'drop-bin')); }
  panel.addEventListener('dragstart', (e) => {
    const part = e.target.closest('.part'), chip = e.target.closest('.chip:not(.ghost)');
    if (part) drag = { kind: part.dataset.k }; else if (chip) drag = { uid: chip.dataset.u }; else return;
    e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'part'); } catch (err) { /* ignore */ }
  });
  panel.addEventListener('dragend', () => { drag = null; clearMarks(); });
  panel.addEventListener('dragover', (e) => {
    if (!drag) return;
    const chips = e.target.closest('.zone') && e.target.closest('.zone').querySelector('.chips'), bin = e.target.closest('.ws-bin');
    clearMarks();
    if (chips) {
      e.preventDefault();
      const i = dropIndex(chips, e.clientX, e.clientY), cs = chips.querySelectorAll('.chip:not(.ghost)');
      if (cs[i]) cs[i].classList.add('drop-before'); else chips.classList.add('drop-end');
    } else if (bin && drag.uid) { e.preventDefault(); bin.classList.add('drop-bin'); }
  });
  panel.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault(); clearMarks();
    const zoneEl = e.target.closest('.zone'), bin = e.target.closest('.ws-bin'), d = drag; drag = null;
    if (zoneEl) {
      const zi = +zoneEl.dataset.z, at = dropIndex(zoneEl.querySelector('.chips'), e.clientX, e.clientY);
      if (d.kind) addPart(d.kind, zi, at); else movePiece(d.uid, zi, at);
    } else if (bin && d.uid) removePiece(d.uid);
  });
  window.addEventListener('keydown', (e) => {
    if (!st || st.view !== 'build' || !$('#modal').hidden) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) { e.preventDefault(); removePiece(st.sel); }
    if (e.key === 'Escape' && st.sel) { st.sel = null; render(); markSel(); }
    if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && st.undo.length) { e.preventDefault(); st.build = JSON.parse(st.undo.pop()); st.sel = null; after(null); }
  });

  // ------------------------------------------------------------ menu
  function openMenu() {
    const W = wsave(), box = $('#modal'); box.hidden = false;
    const fams = ['classic', 'modern', 'moe'];
    const models = MODELS.filter(usable);
    const bpList = fams.map((fk) => {
      const ms = models.filter((m) => family(m) === fk); if (!ms.length) return '';
      return `<h4>${FAMILIES[fk].name}</h4><p class="fam">${esc(FAMILIES[fk].desc)}</p><div class="ws-list">${ms.map((m) => {
        const dif = difficulty(m), got = W.bp[m.id] || 0;
        return `<button class="pbtn" data-bp="${esc(m.id)}" style="--c:${m.cartColor || '#29adff'}"><span class="nm">${esc(m.name)}</span><span class="dif">${'■'.repeat(dif)}${'□'.repeat(3 - dif)}</span><span class="got">${got ? '★'.repeat(got) + '☆'.repeat(3 - got) : 'NEW'}</span></button>`;
      }).join('')}</div>`;
    }).join('');
    const remix = fams.map((fk) => {
      const ms = models.filter((m) => family(m) === fk); if (!ms.length) return '';
      return `<div class="ws-list small"><span class="lab">${FAMILIES[fk].name}</span>${ms.map((m) => `<button class="pbtn small" data-remix="${esc(m.id)}">${esc(m.name)}</button>`).join('')}</div>`;
    }).join('');
    box.innerHTML = `<div class="mbox pbox ws-menu"><h2>THE WORKSHOP</h2>
      <p class="intro">Build an LLM out of the same parts you've been inspecting. Every model is the same kit with different choices: which attention, which norm, where it goes, dense or experts.</p>
      <div class="ws-cols">
        <section><h3>BLUEPRINTS <small>GUIDED</small></h3><p>Rebuild a real model. Each empty slot describes its job; you pick the part that does it, then its type. ■ = difficulty.</p>${bpList}</section>
        <section><h3>FREE BUILD <small>SANDBOX</small></h3><p>Invent your own. The foreman checks your wiring, the meters show size and memory, and the detector tells you which real model yours looks like.</p>
          <div class="ws-list"><button class="pbtn gold" data-free="empty">START FROM AN EMPTY LOT</button>${W.last ? '<button class="pbtn" data-free="last">CONTINUE LAST BUILD</button>' : ''}</div>
          <h4>OR REMIX A CARTRIDGE</h4>${remix}
        </section>
      </div>
      <div class="mfoot"><button class="pbtn" data-a="x">CLOSE</button></div></div>`;
    box.onclick = (e) => {
      if (e.target === box || e.target.closest('[data-a="x"]')) { box.hidden = true; return; }
      const bpB = e.target.closest('[data-bp]'), fr = e.target.closest('[data-free]'), rx = e.target.closest('[data-remix]');
      const byId = (id) => MODELS.find((m) => m.id === id);
      if (bpB) { box.hidden = true; startBlueprint(byId(bpB.dataset.bp)); }
      if (rx) { box.hidden = true; startFree(fromModel(byId(rx.dataset.remix))); }
      if (fr) {
        box.hidden = true;
        if (fr.dataset.free === 'last' && W.last) { const b = JSON.parse(JSON.stringify(W.last)); b.zones.forEach((z) => z.pieces.forEach((q) => (q.uid = 'u' + ++U))); startFree(b); }
        else startFree({ d: 2048, vocab: 128256, zones: [{ type: 'input', pieces: [] }, { type: 'block', repeat: 16, label: 'TRANSFORMER BLOCK', pieces: [] }, { type: 'output', pieces: [] }] });
      }
    };
  }
  $('#btn-workshop').onclick = openMenu;

  return {
    onPieceClick(o) {
      if (!st || st.view !== 'build') return false;
      st.sel = o.p.uid; const f = find(st.sel); if (f) st.zone = f.zi;
      render(); markSel(); revealSettings(); o.flash = 1; sfx.select();
      return true;
    },
    building: () => !!st && st.view === 'build',
    close,
  };
};
})();
