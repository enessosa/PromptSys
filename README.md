# PromptSys

**See, negotiate and verify the context behind every AI answer.**

> **Status:** Planning phase. Nothing here is implemented yet; this README describes the intended design.

---

## The problem

When you talk to an AI assistant, a lot more goes into an answer than your message: memory entries, uploaded files, search results, earlier turns, system instructions. Neither side can talk about it:

- **You** don't know which of these actually shaped the answer.
- **You** can't say "leave that out" before the answer is generated.
- **The model** can only *claim* what it used; nobody checks whether that claim is true.

Human and AI never agree on a shared basis for the conversation.

## The idea

PromptSys is a self-hosted chat application that sits **in front of** the model instead of inside it. Because it assembles the context itself, it knows exactly what was sent and can show every piece as a **context card**.

```
┌────────────┐      ┌─────────────────────────────┐      ┌───────────┐
│  Browser   │ ───▶ │  PromptSys                  │ ───▶ │  LLM API  │
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

### Later
- [ ] Local model (e.g. via Ollama) for likelihood attribution
- [ ] Web search results as cards

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Java, Spring Boot |
| Frontend | React |
| Database | PostgreSQL |
| LLM | Anthropic Claude API |
| Deployment | Docker image (GHCR), self-hosted |

## Open questions

- **Granularity:** What is one card: a whole document, a section, a sentence?
- **Noise:** How many regenerations are needed before an ablation result is trustworthy?
- **Cost:** Ablation costs one extra API call per card. Is that acceptable for on-demand use?
- **Model knowledge:** How do we show the difference between "the card was irrelevant" and "the model already knew this anyway"?

## Related work

- [ContextCite](https://github.com/MadryLab/context-cite) — context attribution via ablation and a linear surrogate model (NeurIPS 2024)
- [AttriBoT](https://github.com/r-three/AttriBoT) — efficient leave-one-out context attribution (ICLR 2025)
- [larpie](https://pypi.org/project/larpie/) — developer middleware for attribution of LLM calls

PromptSys does not try to advance this research. It aims to make it usable as an end-user interface.

## License

[MIT](LICENSE)
