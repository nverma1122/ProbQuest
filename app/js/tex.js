/* Minimal TeX-style math renderer (no dependencies, works offline).
   Supports: $...$ segments, \frac \dfrac \tfrac \binom \dbinom \sqrt \text \mathrm \overline \bar, ^ _ , Greek letters,
   set/relational symbols and the few macros used by the question bank. Text outside $...$ is passed through as HTML. */
(function (root) {
  'use strict';
  const SYM = { cap: '∩', cup: '∪', mid: '∣', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', times: '×', cdot: '·',
    dots: '…', ldots: '…', cdots: '⋯', sum: '∑', prod: '∏', int: '∫', infty: '∞', to: '→', approx: '≈', pm: '±', sim: '∼',
    sigma: 'σ', mu: 'μ', lambda: 'λ', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', rho: 'ρ', pi: 'π', Phi: 'Φ', Gamma: 'Γ',
    phi: 'φ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', omega: 'ω', tau: 'τ', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', in: '∈', subset: '⊂', emptyset: '∅', setminus: '∖', iff: '⇔', Rightarrow: '⇒',
    Leftarrow: '⇐', rightarrow: '→', leftarrow: '←', prime: '′', ln: 'ln', log: 'log', exp: 'exp', min: 'min', max: 'max', Pr: 'Pr',
    cos: 'cos', sin: 'sin', lim: 'lim', Var: 'Var', approxeq: '≈', ge_: '≥', geq_: '≥', circ: '∘' };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const FN = new Set(['ln', 'log', 'exp', 'min', 'max', 'Pr', 'cos', 'sin', 'lim', 'Var']);

  function mathToHtml(src) {
    let i = 0; const s = src;
    const ws = () => { while (i < s.length && s[i] === ' ') i++; };
    function group() { i++; const h = seq('}'); i++; return h; }
    function arg() {
      ws(); if (i >= s.length) return '';
      if (s[i] === '{') return group();
      if (s[i] === '\\') return cmd();
      const c = s[i++]; return atom(c);
    }
    function seq(stop) { let out = ''; while (i < s.length && s[i] !== stop) out += item(); return out; }
    function atom(c) {
      if (/[A-Za-z]/.test(c)) return '<i>' + c + '</i>';
      if (c === '-') return '−';
      if (c === '<') return '&lt;'; if (c === '>') return '&gt;'; if (c === '&') return '&amp;';
      return c;
    }
    function item() {
      const c = s[i];
      if (c === '\\') return cmd();
      if (c === '{') return '<span>' + group() + '</span>';
      if (c === '^') { i++; return '<sup>' + arg() + '</sup>'; }
      if (c === '_') { i++; return '<sub>' + arg() + '</sub>'; }
      i++; return atom(c);
    }
    function raw() { // {text} group taken literally
      ws(); if (s[i] !== '{') return esc(arg());
      i++; let d = 1, t = '';
      while (i < s.length) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (!d) break; } t += s[i++]; }
      i++; return esc(t);
    }
    function cmd() {
      i++; let name = '';
      if (i < s.length && /[A-Za-z]/.test(s[i])) { while (i < s.length && /[A-Za-z]/.test(s[i])) name += s[i++]; }
      else name = s[i++];
      switch (name) {
        case 'frac': case 'dfrac': case 'tfrac': { const a = arg(), b = arg(); return `<span class="fr"><span class="n">${a}</span><span class="d">${b}</span></span>`; }
        case 'binom': case 'dbinom': { const a = arg(), b = arg(); return `<span class="bn"><span class="par">(</span><span class="fr"><span class="n">${a}</span><span class="d">${b}</span></span><span class="par">)</span></span>`; }
        case 'sqrt': { const a = arg(); return `<span class="sq">√<span class="rad">${a}</span></span>`; }
        case 'text': case 'mathrm': case 'textbf': case 'mathbf': return `<span class="rm">${raw()}</span>`;
        case 'overline': case 'bar': return `<span class="ov">${arg()}</span>`;
        case 'left': case 'right': case 'big': case 'Big': case 'bigg': case 'Bigg': return '';
        case 'iint': return '∬';
        case 'quad': return '<span class="sp2"></span>';
        case ',': case ';': case '!': case ' ': return '<span class="sp1"></span>';
        case '{': return '{'; case '}': return '}'; case '$': return '$'; case '%': return '%'; case '|': return '‖';
        case '\\': return '<br>';
        default:
          if (FN.has(name)) return `<span class="fn">${name}</span>`;
          if (SYM[name] !== undefined) return SYM[name];
          return esc('\\' + name);
      }
    }
    return seq(null);
  }

  function tex(text) {
    if (text == null) return '';
    const s = String(text);
    let out = '', i = 0, buf = '';
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '$') { buf += '$'; i += 2; continue; }
      if (c === '$') {
        // find closing unescaped $
        let j = i + 1; while (j < s.length && !(s[j] === '$' && s[j - 1] !== '\\')) j++;
        if (j >= s.length) { buf += s.slice(i); break; }
        out += buf; buf = '';
        out += '<span class="m">' + mathToHtml(s.slice(i + 1, j)) + '</span>';
        i = j + 1; continue;
      }
      buf += c; i++;
    }
    return out + buf;
  }

  root.PQ_TEX = { tex, mathToHtml };
})(typeof window !== 'undefined' ? window : globalThis);
