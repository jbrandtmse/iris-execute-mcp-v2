// The scan that finds a repository script importing a TypeScript file, shared by its test
// (`packages/iris-mcp-all/src/__tests__/script-ts-imports.test.ts`) and any script that wants to run it.
//
// CONTRACT
//   Node strips types from a `.ts` file only from 22.18, and the floor of every published package is 22.17.0 (the lowest leg
//   of the `gates` job). A script run with plain `node` that imports a `.ts` file therefore fails on the floor with
//   `ERR_UNKNOWN_FILE_EXTENSION`, while it passes on any newer Node. A script imports the built `.js` of a package instead.
//   A SCRIPT is a `.mjs`, `.js` or `.cjs` file under `scripts/`, `packages/*/scripts/` or `extensions/*/scripts/`.
//   The scan reads each script with its comments removed and reports:
//     - a static `import ... from`, bare `import`, or `export ... from` whose specifier ends in `.ts`, `.mts`, `.cts` or `.tsx`;
//     - a dynamic `import(...)` or `require(...)` whose argument holds such a literal;
//     - a dynamic `import(...)` or `require(...)` whose argument names a variable that the same file builds from such a
//       literal (`const outPath = resolve(root, 'a/b.ts'); await import(pathToFileURL(outPath).href)`). A variable that is only
//       written to or read as text is not reported, and neither is an argument the scan cannot trace (a parameter).
//   The scan is lexical, so it does not find: a path assigned after its declaration, a literal that spans lines or sits inside a
//   template's `${...}`, an initializer continued after a trailing operator (`root +` then the literal on the next line), a second
//   declarator of one statement (`const a = 1, p = './x.ts'`), a require made by `createRequire`, an import that follows a regular
//   expression placed right after a `)` (the `/` is read as division), a statement that shares its line with another, or a bare
//   specifier whose package `exports` target is a `.ts` file. A variable name is matched wherever the file declares it, whatever
//   the scope.
//   Every scan reads files and never runs anything.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from './live-gate-scan.mjs';

const TS_LITERAL = /(['"`])(?:(?!\1)[^\\\n]|\\.)*\.(?:m|c)?tsx?\1/;
const TS_SPECIFIER = /\.(?:m|c)?tsx?$/;
const REGEX_PREFIX = /[(,=:[!&|?{};+\-*%<>~^]$/;
const REGEX_KEYWORD = /(?<![\w$.])(?:return|typeof|case|in|of|else|do|void|yield|await|throw|delete|new|instanceof)\s*$/;
const QUOTED_STRING = /(['"])(?:(?!\1)[^\\\n]|\\.)*\1/g;

/**
 * Lex a script: `code` is the source with every comment replaced by spaces (line breaks kept), so offsets and line numbers still
 * match; `masked` is `code` with the inside of every string, template and regular-expression literal replaced by `x`, so a call or
 * an import that is only text in a literal is not found. A `/` starts a regular expression when the last significant character
 * before it cannot end an operand, which is the usual rule and enough for the repository's scripts.
 *
 * @param {string} source
 * @returns {{ code: string, masked: string }}
 */
function lex(source) {
  let code = '';
  let masked = '';
  let lastSignificant = '';
  let index = 0;
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  const mask = (text) => text.replace(/[^\n]/g, 'x');
  const literal = (end, openLength) => {
    const text = source.slice(index, end);
    code += text;
    masked += text.slice(0, openLength) + mask(text.slice(openLength, -1)) + text.slice(-1);
    index = end;
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      code += blank(source.slice(index, stop));
      masked += blank(source.slice(index, stop));
      index = stop;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      code += blank(source.slice(index, stop));
      masked += blank(source.slice(index, stop));
      index = stop;
    } else if (char === '"' || char === "'" || char === '`') {
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== char) cursor += source[cursor] === '\\' ? 2 : 1;
      literal(Math.min(cursor + 1, source.length), 1);
      lastSignificant = char;
    } else if (
      char === '/' &&
      (lastSignificant === '' || REGEX_PREFIX.test(lastSignificant) || REGEX_KEYWORD.test(code.slice(-200)))
    ) {
      let cursor = index + 1;
      let inClass = false;
      while (cursor < source.length && source[cursor] !== '\n') {
        const current = source[cursor];
        if (current === '\\') cursor += 1;
        else if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) break;
        cursor += 1;
      }
      literal(Math.min(cursor + 1, source.length), 1);
      lastSignificant = '/';
    } else {
      code += char;
      masked += char;
      if (!/\s/.test(char)) lastSignificant = char;
      index += 1;
    }
  }
  return { code, masked };
}

/** The source with every comment replaced by spaces (see {@link lex}). */
export function stripComments(source) {
  return lex(source).code;
}

/** The text between the parenthesis that opens at `open` and its match, or the rest of the source when it never closes. */
function balancedArgument(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index += 1;
      while (index < source.length && source[index] !== char) index += source[index] === '\\' ? 2 : 1;
    } else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return source.slice(open + 1);
}

/** The initializer text of each `const`, `let` or `var` declaration of one identifier, up to its `;` at depth 0 or its end of line. */
function initializers(source) {
  const found = new Map();
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    let depth = 0;
    let index = match.index + match[0].length;
    const start = index;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"' || char === "'" || char === '`') {
        index += 1;
        while (index < source.length && source[index] !== char) index += source[index] === '\\' ? 2 : 1;
      } else if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char)) depth -= 1;
      else if ((char === ';' || char === '\n') && depth <= 0) {
        // A newline ends the statement only when the next line does not continue it.
        if (char === ';' || !/^\s*[+\-*/%&|?:.,]/.test(source.slice(index + 1, index + 40))) break;
      }
      if (depth < 0) break;
    }
    const name = match[1];
    found.set(name, `${found.get(name) ?? ''}\n${source.slice(start, index)}`);
  }
  return found;
}

/** The first `.ts`-family literal that `expression` holds, directly or through the variables it names, or `undefined`. */
function tsLiteralBehind(expression, declared, seen = new Set()) {
  const direct = TS_LITERAL.exec(expression);
  if (direct !== null) return direct[0];
  // The words of a quoted string are text, not variables: `import('./lib/outPath.js')` does not read `outPath`.
  for (const identifier of expression.replace(QUOTED_STRING, '""').matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = identifier[0];
    if (seen.has(name) || !declared.has(name)) continue;
    seen.add(name);
    const behind = tsLiteralBehind(declared.get(name), declared, seen);
    if (behind !== undefined) return `${behind} (through ${name})`;
  }
  return undefined;
}

/**
 * The `.ts` imports of one script, as one problem per import.
 *
 * @param {string} source - The script's text.
 * @param {string} [file] - Its name, for the messages.
 * @returns {string[]}
 */
export function tsImportProblems(source, file = 'script') {
  const { code, masked } = lex(source);
  const lineOf = (offset) => code.slice(0, offset).split('\n').length;
  const problems = [];

  // The statements are found in the masked view (so text inside a literal is never one) and read from the code view.
  for (const match of masked.matchAll(/^[ \t]*(?:import|export)\b(?:[^'"`;]*?\bfrom)?\s*(['"])([^'"\n]+)\1/gm)) {
    const specifierEnd = match.index + match[0].length - 1;
    const specifier = code.slice(specifierEnd - match[2].length, specifierEnd);
    if (TS_SPECIFIER.test(specifier)) problems.push(`${file}:${lineOf(match.index)} imports ${specifier}`);
  }

  const declared = initializers(code);
  for (const match of masked.matchAll(/(?<![\w$.])(import|require)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const behind = tsLiteralBehind(balancedArgument(code, open), declared);
    if (behind !== undefined) problems.push(`${file}:${lineOf(match.index)} ${match[1]}s a TypeScript file: ${behind}`);
  }
  return problems;
}

/** The script files of the repository: `.mjs`, `.js` and `.cjs` files under the script directories, as absolute paths, sorted. */
export function scriptFiles(repoRoot = REPO_ROOT) {
  const roots = [path.join(repoRoot, 'scripts')];
  for (const group of ['packages', 'extensions']) {
    const groupDir = path.join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(path.join(groupDir, entry.name, 'scripts'));
    }
  }
  const found = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(?:m|c)?js$/.test(entry.name)) found.push(full);
    }
  };
  for (const root of roots) visit(root);
  return found.sort();
}

/** The `.ts` imports of every script of the repository, as `<relative path>:<line> ...` problems. */
export function scriptTsImportProblems(repoRoot = REPO_ROOT) {
  return scriptFiles(repoRoot).flatMap((file) =>
    tsImportProblems(readFileSync(file, 'utf8'), path.relative(repoRoot, file).split(path.sep).join('/')),
  );
}
