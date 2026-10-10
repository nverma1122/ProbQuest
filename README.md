# ProbQuest

Probability practice for undergraduate economics students: 466 independently authored questions with hints, worked
solutions, misconception diagnosis, adaptive practice, revision, exams and a daily challenge. The student interface shows
no textbook or source information. Progress is saved in the student's own browser only (no accounts, no sync).

```
app/         the application: index.html, js/engine.js, js/app.js, js/tex.js, css/style.css, data/qbank.js|json
bank/        SOURCE of the questions: topics.json, questions/<topic>.json, optional extra/*.json, dup_allow.json
build/       build.js: validates the source and writes app/data/qbank.js and qbank.json
tests/       engine.test.js, sim_repeat.js, audit_leaks.js, audit_bank.js, serve.js
docs/        EXPANSION_REPORT.md (what the 466-question bank and repetition control are, and how they were checked)
```

## Everyday use

| Task | Command |
|---|---|
| Run locally | `node tests/serve.js`, then open http://localhost:8765 (or just open `app/index.html`) |
| Rebuild after editing questions | `node build/build.js` |
| Run all checks | `node build/build.js && node tests/engine.test.js && node tests/sim_repeat.js && node tests/audit_leaks.js` |
| Count and distribution | `node tests/audit_bank.js` |

## Editing or adding questions

Edit `bank/questions/<topic>.json`, or put a new file of questions in `bank/extra/` (same format, a JSON array), then run
`node build/build.js`. A question has: `id` (`AAA-NN`, unique, neutral), `topic`, `sub`, `diff` (1 to 3), `kind`
(`mcq` or `num`), `stem`, `answer` `{value, display}`, `options` (for `mcq`: one `correct`, wrong ones with a `why`),
`hints` (exactly 3), `solution` (list of steps), `concept`, `misconception`, `why`, `fam` (structure family).
Math goes between `$...$`. The build rejects duplicate ids, missing hints or solutions, a wrong or missing key, unbalanced
TeX, textbook-style wording, exact and near-duplicate questions, and anything that does not render.

Repetition control (one history for all modes, cooldown, structure variety, exposure balance) lives in
`app/js/engine.js` and is independent of the question content, so adding questions needs no code change.

## Note on this rebuild

The authoring scripts that originally generated the bank (answers computed in code, with independent re-derivation
checks) were lost from this folder. This source was rebuilt from the shipped `qbank.js`: the content is
byte-for-byte identical (466 questions), but the answers are now stored values rather than computed ones. When adding
numeric questions, check the answer independently.
