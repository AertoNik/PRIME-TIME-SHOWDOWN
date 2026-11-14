import { fs, path } from './node';

/**
 * Beta 2.1 final — plain '…' / "…" strings in the game's code that hold `${name}`: a template written in the wrong
 * quotes, so the player reads «${LEAGUE.defenseRep.win}» instead of the number (the Beta 2.0 defence note in PRIME
 * LEAGUE did exactly that). A small tokenizer — strings, template literals with nested `${ … }`, comments — over every
 * .ts file under `dir`; returns «file:line  text» for each such string.
 */
export function quotedTemplates(dir: string): string[] {
  const hits: string[] = [];
  const scan = (file: string): void => {
    const s = fs.readFileSync(file, 'utf8') as string;
    const stack: { k: 'code' | 'tpl'; depth: number }[] = [{ k: 'code', depth: 0 }];
    let i = 0;
    let line = 1;
    while (i < s.length) {
      const c = s[i];
      const top = stack[stack.length - 1];
      if (c === '\n') line++;
      if (top.k === 'tpl') {
        if (c === '\\') i += 2;
        else if (c === '`') (stack.pop(), i++);
        else if (c === '$' && s[i + 1] === '{') (stack.push({ k: 'code', depth: 0 }), (i += 2));
        else i++;
        continue;
      }
      if (c === '/' && s[i + 1] === '/') {
        while (i < s.length && s[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && s[i + 1] === '*') {
        const e = s.indexOf('*/', i + 2);
        for (let k = i; k < e; k++) if (s[k] === '\n') line++;
        i = e < 0 ? s.length : e + 2;
        continue;
      }
      if (c === "'" || c === '"') {
        let j = i + 1;
        let txt = '';
        while (j < s.length && s[j] !== c && s[j] !== '\n') {
          if (s[j] === '\\') {
            txt += s[j] + (s[j + 1] ?? '');
            j += 2;
            continue;
          }
          txt += s[j++];
        }
        if (/\$\{[A-Za-z_]/.test(txt)) hits.push(`${path.relative(dir, file)}:${line}  ${txt.slice(0, 80)}`);
        i = j + 1;
        continue;
      }
      if (c === '`') stack.push({ k: 'tpl', depth: 0 });
      else if (c === '{') top.depth++;
      else if (c === '}') {
        if (top.depth === 0 && stack.length > 1) stack.pop();
        else top.depth--;
      }
      i++;
    }
  };
  const walk = (d: string): void => {
    for (const f of fs.readdirSync(d) as string[]) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f)) scan(p);
    }
  };
  walk(dir);
  return hits;
}
