#!/usr/bin/env python3
"""Validate LLM Arcade model files (models/<id>.js).

Usage:
  python3 validate_model.py path/to/app/models/qwen3-235b-a22b.js [more files...]
  python3 validate_model.py path/to/app/models          # every model in the folder

Each file must be `LLMArcade.register(<strict JSON>);`. Exits 1 if any ERROR is found.
WARN lines are teaching-quality nudges, not blockers.
"""
import json
import re
import sys
from pathlib import Path

KINDS = {"tokenizer", "embedding", "posenc", "norm", "attention", "add", "ffn", "moe", "lmhead", "sampler", "custom"}
ATTN_VARIANTS = {"mha", "gqa", "mqa", "mla", "sliding", "alternating"}


def load(path: Path):
    src = path.read_text(encoding="utf-8").strip()
    m = re.match(r"^LLMArcade\.register\((.*)\);?\s*$", src, re.S)
    if not m:
        raise ValueError("file must be exactly `LLMArcade.register({...});`")
    return json.loads(m.group(1))


def check(model, path: Path):
    errs, warns = [], []
    E, W = errs.append, warns.append

    for f in ("id", "name", "pieces"):
        if f not in model:
            E(f"missing top-level field '{f}'")
    if errs:
        return errs, warns
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", model["id"]):
        E(f"id '{model['id']}' should be lowercase letters, digits, '-' or '.'")
    if path.stem != model["id"]:
        E(f"file name '{path.name}' must match id '{model['id']}.js'")
    for f in ("maker", "year", "tagline", "source", "d", "vocab", "stats", "cartColor"):
        if f not in model:
            W(f"top-level '{f}' is missing (the level-select cartridge and narration use it)")
    if "source" in model and "raschka" not in model["source"].lower():
        W("'source' should credit the Sebastian Raschka diagram/article the model came from")

    blocks = {b.get("id"): b for b in model.get("blocks", [])}
    for bid, b in blocks.items():
        if not isinstance(b.get("repeat"), int) or b["repeat"] < 1:
            E(f"block '{bid}' needs an integer 'repeat' >= 1 (the xN on the diagram)")

    pieces = model["pieces"]
    ids = [p.get("id") for p in pieces]
    seen = set()
    for i, p in enumerate(pieces):
        pid = p.get("id")
        where = f"piece[{i}] '{pid}'"
        if not pid:
            E(f"piece[{i}] has no id")
            continue
        if pid in seen:
            E(f"duplicate piece id '{pid}'")
        seen.add(pid)
        kind = p.get("kind")
        if kind not in KINDS:
            E(f"{where}: unknown kind '{kind}' (use one of {sorted(KINDS)})")
        if kind == "custom" and not p.get("blurb"):
            E(f"{where}: custom pieces must supply their own blurb/detail (there is no default text)")
        if p.get("block") and p["block"] not in blocks:
            E(f"{where}: block '{p['block']}' is not declared in 'blocks'")
        if kind == "attention":
            v = p.get("variant", "mha")
            if v not in ATTN_VARIANTS:
                W(f"{where}: attention variant '{v}' has no special visuals (known: {sorted(ATTN_VARIANTS)})")
            if not p.get("heads"):
                W(f"{where}: set 'heads' so the query-head windows match the model")
            if v in ("gqa", "mqa") and not p.get("kvHeads"):
                E(f"{where}: {v} attention needs 'kvHeads'")
        if kind == "moe":
            for f in ("experts", "active"):
                if not isinstance(p.get(f), int):
                    E(f"{where}: MoE needs integer '{f}'")
            if "shared" not in p:
                W(f"{where}: say explicitly whether there is a shared expert ('shared': true/false)")
        if kind == "ffn" and not p.get("hidden"):
            W(f"{where}: set 'hidden' (FFN intermediate size) so the narration shows the real number")
        if kind == "add":
            rf = p.get("residualFrom")
            if not rf:
                E(f"{where}: residual add needs 'residualFrom' (the piece where the bypass branches off)")
            elif rf not in ids[:i]:
                E(f"{where}: residualFrom '{rf}' must be an earlier piece")
            else:
                src = pieces[ids.index(rf)]
                if src.get("block") != p.get("block"):
                    E(f"{where}: residualFrom '{rf}' must be in the same block")
        if kind == "tokenizer" and "tokenizerDemo" in p:
            demo = p["tokenizerDemo"]
            if not isinstance(demo, list) or not demo:
                E(f"{where}: tokenizerDemo must be a non-empty list of {{text, tokens}}")
            else:
                for n, w in enumerate(demo):
                    if not isinstance(w, dict) or not isinstance(w.get("text"), str) or not isinstance(w.get("tokens"), list) or not w["tokens"]:
                        E(f"{where}: tokenizerDemo[{n}] needs a 'text' string and a non-empty 'tokens' list")
                    elif "".join(w["tokens"]) != w["text"]:
                        E(f"{where}: tokenizerDemo[{n}] tokens {w['tokens']} don't join back into {w['text']!r}")
                if not any(isinstance(w, dict) and len(w.get("tokens") or []) > 1 for w in demo):
                    W(f"{where}: no tokenizerDemo word splits into several tokens; the grinder demo is built around showing one")
        if not p.get("facts") and kind not in ("add", "sampler", "norm"):
            W(f"{where}: no 'facts' table; add the model-specific numbers")

    # block pieces must be contiguous runs, otherwise rooms split weirdly
    order = [p.get("block") for p in pieces]
    closed = set()
    prev = None
    for b in order:
        if b != prev and prev is not None:
            closed.add(prev)
        if b is not None and b in closed:
            E(f"pieces of block '{b}' are not contiguous; keep each block's pieces together")
            break
        prev = b
    if order and order[0] is not None:
        W("first piece is inside a block; usually tokenizer/embedding come first")
    kinds = [p.get("kind") for p in pieces]
    for need in ("tokenizer", "embedding", "lmhead"):
        if need not in kinds:
            W(f"no '{need}' piece; most diagrams have one")

    quiz = model.get("quiz", [])
    if len(quiz) < 5:
        W(f"only {len(quiz)} hand-written quiz questions; aim for 6-8")
    finds = 0
    for j, q in enumerate(quiz):
        where = f"quiz[{j}]"
        if not q.get("q"):
            E(f"{where}: missing 'q'")
        if not q.get("explain"):
            W(f"{where}: add an 'explain' so wrong answers still teach")
        t = q.get("type", "choice")
        if t == "find":
            finds += 1
            if q.get("answer") not in ids:
                E(f"{where}: find answer '{q.get('answer')}' is not a piece id")
        elif t == "choice":
            opts = q.get("options", [])
            if not 2 <= len(opts) <= 4:
                E(f"{where}: choice questions need 2-4 options")
            if not isinstance(q.get("answer"), int) or not 0 <= q["answer"] < len(opts):
                E(f"{where}: 'answer' must be the index of the correct option")
        else:
            E(f"{where}: type must be 'choice' or 'find'")
        if q.get("piece") and q["piece"] not in ids:
            E(f"{where}: piece '{q['piece']}' does not exist")
    if quiz and finds < 2:
        W("fewer than 2 'find' questions; clicking pieces in 3D is the most game-like part")

    manifest = path.parent / "manifest.js"
    if manifest.exists() and f'"{model["id"]}"' not in manifest.read_text(encoding="utf-8"):
        E(f"'{model['id']}' is not listed in {manifest.name}, so it won't show up on the level-select screen")
    return errs, warns


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    files = []
    for a in argv:
        p = Path(a)
        files += sorted(x for x in p.glob("*.js") if x.name != "manifest.js") if p.is_dir() else [p]
    bad = 0
    for f in files:
        try:
            model = load(f)
            errs, warns = check(model, f)
        except Exception as e:  # noqa: BLE001
            errs, warns = [f"could not parse: {e}"], []
        status = "OK " if not errs else "ERR"
        print(f"[{status}] {f.name}: {len(errs)} error(s), {len(warns)} warning(s)")
        for e in errs:
            print(f"   ERROR {e}")
        for w in warns:
            print(f"   WARN  {w}")
        bad += bool(errs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
