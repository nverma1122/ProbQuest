# Question bank expansion and repetition control (internal report)

Internal quality-assurance record. Nothing here is shipped in `app/`.

## Result

| Measure | Before | After |
|---|---|---|
| Live questions | 317 | **466** |
| Exact duplicates | 0 | 0 |
| Near-duplicate groups (same structure and answer, changed wording or numbers) | 68 | 0 (68 retired, keeping the strongest version of each) |
| Valid unique questions after de-duplication | 249 | 249 |
| New original questions added | | **217** |
| Difficulty (foundational / intermediate / advanced) | | 108 / 213 / 145 = 23% / 46% / 31% (target 25/45/30) |
| Kinds | | 330 multiple choice, 136 typed numeric; 27 diagnostic items |

| Topic | Total | New | F | I | A |
|---|---|---|---|---|---|
| Sample spaces and events | 24 | 17 | 10 | 11 | 3 |
| Counting methods | 46 | 22 | 12 | 23 | 11 |
| Probability rules | 67 | 26 | 21 | 29 | 17 |
| Conditional probability | 56 | 26 | 8 | 26 | 22 |
| Independence | 53 | 24 | 12 | 24 | 17 |
| Total probability and Bayes | 65 | 30 | 10 | 29 | 26 |
| Random variables and expectation | 57 | 25 | 15 | 24 | 18 |
| Standard distributions | 69 | 28 | 16 | 32 | 21 |
| Joint distributions | 29 | 19 | 4 | 15 | 10 |

## Why questions repeated

* No history shared across modes or restarts.
* Weakness practice kept choosing the same few questions (replaying the old logic: 47.7% repeated in the next game, 24
  distinct questions in 40 games).
* Some topics had fewer questions than one session.
* Learn replayed a small pool at the student's current level.

## What prevents repeats now (`app/js/engine.js`)

One served-history for every mode, kept in `localStorage`. Rules, in priority order: never twice in a game; 5-game
cooldown; avoid the structure family of the last two questions; widen the pool (next difficulty, other topics) before
reusing anything; reuse the longest-unseen question only when everything is exhausted, and say so. Choice is weighted
toward rarely served questions; mixed sets follow the 25/45/30 blueprint with even topic shares. Missed questions return
deliberately (Revision, or a labelled revisit, never back to back). Daily challenge questions that closed one rotation
cannot open the next. Extra question packs (`window.PQ_EXTRA`) are validated at load; bad questions are skipped.
History is per browser; there is no cross-device sync and the interface does not claim any.

## Verification (on the rebuilt project)

* `node build/build.js`: 466 questions, 0 errors, 0 warnings.
* `node tests/engine.test.js`: 41 passed, 0 failed.
* `node tests/sim_repeat.js` (seeded): 35 passed, 0 failed. Zero repeats inside a game and zero inside the cooldown in
  every mode; 600 games touch the whole bank.
* `node tests/audit_leaks.js`: 0 hits. `node tests/audit_bank.js`: 466 unique, 0 exact, 0 near duplicates.
* In-app browser: all modes run without console errors; no horizontal overflow at 375 px.

## Rebuild note

The original generating scripts (answers computed in code with independent re-derivations) were lost from the folder.
The source in `bank/` was rebuilt from the shipped `qbank.js`; content is identical but answers are stored values.
