# Writing the teaching text

The audience is curious people who like games, not LLM researchers. The arcade should feel like a friendly game guide explaining a machine, not like reading a paper.

## Voice

- Short sentences. One idea each. Concrete verbs: *chops, grabs, squishes, routes, rejoins*.
- Define jargon the first time, in the same sentence: "GQA (groups of query heads share one key/value head)".
- Numbers are fun when they mean something: "64 query heads share just 4 K/V heads, so the cache is 16x smaller", not just "kvHeads: 4".
- Analogies come from everyday life (kitchens, libraries, group chats, triage desks, mixing desks). They must be *structurally* right: the analogy for MoE needs "only a few specialists out of many", not just "experts".
- Point at the 3D object: "the purple funnel on top", "the red band sweeping across". Text that ties to the visual is what makes the 3D worth it.
- No hype, no emoji. Exclamation marks sparingly (the sampler popping a token is a good place for one).

## What goes where

| Field | Length | Job |
|---|---|---|
| `tagline` | 1 sentence | The model's signature move, as a hook |
| `intro` | 2-3 sentences | Tell the player what to look for on this level, especially what differs from earlier cartridges |
| `blurb` | 1 sentence | What the piece does. Skip it if the kind default fits |
| `detail` | 2-4 sentences | How it works in this model |
| `special` | 1-3 sentences | Why this model's version is different and what it buys (memory, speed, stability). Reference other cartridges by name |
| `facts` | 2-5 rows | Hard numbers from the diagram / config. Label in plain words ("K/V heads", not "n_kv") |

## Pacing

Players read every stop of a RUN. AUTO mode gives each stop about 1.6 s plus 1 s per 17 characters, capped at 12 s, so a `flow` override should be one or two sentences (under ~150 characters). Long `detail` text belongs in the inspector, not in the RUN narration.

## Demo words (`tokenizerDemo`)

The tokenizer and embedding demos share these words, so they should read as one natural sentence when joined, with one rarer word near the end that splits into several tokens (the default is "The cat sat on the windowsill", where " windowsill" becomes " window" + "sill"). Each entry's tokens must join back into exactly its text, leading spaces included. Use the model's real tokenizer split when you can check it; otherwise keep the split plausible, since the demo already labels splits and IDs as illustrative.

## Accuracy

- Every number should come from the diagram, the model's config.json or model card, or Raschka's article text. If you can't confirm one, leave it out or say "~" rather than guessing. Wrong numbers in a learning tool are worse than missing ones.
- Distinguish total vs active parameters for MoE models.
- Say "per token" whenever routing or caching is involved, because that's where people's intuitions go wrong.

## Copyright

Use the architecture *facts* (public, and visible in the diagrams) but write every sentence yourself. Don't paste passages from Raschka's articles or embed his figure images in the app. Credit the source in the `source` field; the title screen credits him and links the comparison article.

## Quiz questions that teach

Aim for 6-8 per model, mixing:
1. **Signature question**: the one thing this model is known for (MLA, sliding window ratio, shared expert...).
2. **Number sense**: "how many experts run per token?", "how many K/V heads?". Wrong options should be plausible numbers from the same diagram.
3. **Why / trade-off**: "Why use a sliding window?" with the right answer naming the payoff (KV-cache memory).
4. **Comparison**: against another cartridge ("Unlike Qwen3, DeepSeek has...").
5. **At least two `find` questions**: describe a function or a visual feature and have the player click it in 3D. These are the most game-like moments.

Every question gets an `explain` that teaches even when the player is wrong. Distractors should be wrong for a reason a learner might actually believe, not silly. One light joke option per quiz is fine.
