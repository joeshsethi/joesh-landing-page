# Reader Preferences — Joesh

The research agent reads this file every morning and applies it as ranking and
tone guidance (see `agent/prompt.js`). This is the **feedback loop**: it starts
manual — you edit this file in plain English — and can later be updated
automatically from the 👍/👎/★ signals the page collects (see README §Feedback).

Keep it concrete and inspectable. Each line is an instruction to the editor.

## About the reader
- Full-stack developer (Accenture; the Comcast "garage" project), most fluent in
  AWS. Building this project to learn full front+back-end development with Claude
  Code, and to track AI's real-world impact — technical *and* financial markets.
- Wants an investor's lens as much as an engineer's: who's raising, who's
  shipping, what it costs, who wins.

## Ranking guidance (what to lead with)
- Lead with the single most consequential development of the day, global or Japan.
- Bias toward: model/product launches, funding & deals, research breakthroughs,
  hardware/compute. These are the chosen categories.
- Financial-market angles are first-class: valuations, raises, IPOs, capex,
  public-market read-throughs (e.g. "cleanest public proxy for X is Y").
- Keep generic US funding to one item unless it is >$1B or has a Japan tie.

## Japan focus (always present)
- Always include 3-4 Japan items and keep the gaps tracker current.
- Go deeper on: semiconductors (Rapidus, TSMC dependence), METI policy, sovereign
  / specialized models (Sakana), and where Japan is *behind* and why.
- Frame Japan stories around the gap and the opportunity: where could someone
  build, pitch, or join to close it?

## Tone
- Plain, honest, no hype. Always include the caveat / reality check.
- Real numbers and dates over adjectives.

## Change log (edit as you learn what you want)
- 2026-06-18 — Initial preferences seeded from the project brief.
