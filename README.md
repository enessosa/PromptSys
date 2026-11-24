# PromptSys

**See, negotiate and verify the context behind every AI answer.**

> **Status:** Project skeleton set up (TypeScript backend with Hono, React frontend); no features implemented yet. This README describes the intended design.

---

## The problem

When you talk to an AI assistant, a lot more goes into an answer than your message: memory entries, uploaded files, search results, earlier turns, system instructions. Neither side can talk about it:

- **You** don't know which of these actually shaped the answer.
- **You** can't say "leave that out" before the answer is generated.
- **The model** can only *claim* what it used; nobody checks whether that claim is true.

Human and AI never agree on a shared basis for the conversation.

## The idea

PromptSys is a local chat application, later shipped as a desktop app, that sits **in front of** the model instead of inside it. Because it assembles the context itself, it knows exactly what was sent and can show every piece as a **context card**.

```
┌────────────┐      ┌─────────────────────────────┐      ┌───────────┐
│  UI        │ ───▶ │  PromptSys                  │ ───▶ │  LLM API  │
│  (cards)   │ ◀─── │  registry · assembly · eval │ ◀─── │  (Claude) │
└────────────┘      └─────────────────────────────┘      └───────────┘
```

### Three stages

1. **Before sending — negotiate**
   You see the cards that are about to be sent and can pin, remove or add them.

2. **In the answer — cite**
   Every card gets an ID (`c1`, `c2`, …). The model marks claims with `[c3]`, and the answer shows which cards were used and which were ignored.

3. **After the answer — verify**
   Click *"Why?"* on a card and PromptSys regenerates the answer **without** it, then measures how much the answer changes. That measures what the card actually did, instead of relying on what the model says it did.

### Beyond single answers

- **Derived rules:** PromptSys shows the rules and assumptions the model derived from the context, e.g. *"`required` means the field must be present"*, together with their source (a card or the model's prior knowledge). You can confirm or correct them, so a misunderstanding is caught before it spreads through the whole conversation.
- **Alternate timelines:** Pick an earlier message, change the context (disable, edit or add a card, correct a rule) and replay the following prompts in order. All timelines of a conversation are shown as branches, similar to a Git graph.

## Attribution methods

| Method | How it works | Requires | Reliability |
|---|---|---|---|
| Self-citation | Model tags claims with card IDs | Any API | Low: it's the model's own report |
| Ablation (similarity) | Regenerate without card X, compare via embeddings | Any API + embeddings | Medium: actually tests causation, but noisy |
| Ablation (likelihood) | Score how likely the original answer remains without card X | Local / open-weights model | High |

Version 1 uses **self-citation + similarity ablation**, both of which work with a hosted API. Likelihood-based attribution (see ContextCite, AttriBoT) is a later option via a local model.

## Planned features

### MVP
- [ ] Chat via the Claude API
- [ ] Context registry: notes and files as cards with stable IDs
- [ ] Prompt assembly with ID-tagged context blocks
- [ ] Parsing of citation markers (incl. during streaming)
- [ ] Card view below each answer (used / unused)

### Negotiation
- [ ] Pre-send card review: pin, exclude, add
- [ ] Own memory store, managed as cards
- [ ] Regenerate without selected cards

### Verification
- [ ] "Why?" button: ablation per card
- [ ] Embedding-based change score per card
- [ ] Multiple runs / low temperature to reduce noise

### Understanding
- [ ] Derived rules: show the rules and assumptions the model derived, with their source (card or prior knowledge)
- [ ] Confirm or correct a derived rule; a corrected rule becomes a card

### Alternate timelines
- [ ] Pick an earlier message as branch point, change the context and replay the following prompts
- [ ] Step-by-step replay (recommended) or automatic replay with an explicit warning
- [ ] Branch off during a replay and continue freely
- [ ] Show the expected number of API calls before a replay
- [ ] Branch view of all timelines, similar to a Git graph

### Later
- [ ] Local model (e.g. via Ollama) for likelihood attribution
- [ ] Web search results as cards

## Tech stack

| Layer | Technology |
|---|---|
| Backend | TypeScript, Node.js, Hono |
| Frontend | React, TypeScript, Vite, Primer React |
| Database | SQLite |
| LLM | Anthropic Claude API |
| Deployment | Desktop app with Electron (after the web version) |

## Open questions

- **Granularity:** What is one card: a whole document, a section, a sentence?
- **Noise:** How many regenerations are needed before an ablation result is trustworthy?
- **Model knowledge:** How do we show the difference between "the card was irrelevant" and "the model already knew this anyway"?

Cost is not a reason to leave a feature out: before an ablation or replay, PromptSys shows the expected number of API calls and you decide.

## Related work

- [ContextCite](https://github.com/MadryLab/context-cite) — context attribution via ablation and a linear surrogate model (NeurIPS 2024)
- [AttriBoT](https://github.com/r-three/AttriBoT) — efficient leave-one-out context attribution (ICLR 2025)
- [larpie](https://pypi.org/project/larpie/) — developer middleware for attribution of LLM calls

PromptSys does not try to advance this research. It aims to make it usable as an end-user interface.

## License

[MIT](LICENSE)
