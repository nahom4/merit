/**
 * libSQL executes one statement per call, so a migration file has to be split.
 *
 * Splitting naively on `;` is wrong: it breaks on a semicolon inside a `--` comment or a
 * string literal, and it does so as a syntax error at migration time rather than as anything
 * legible. This scanner tracks both.
 */
export const splitStatements = (sql: string): readonly string[] => {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let inComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    const next = sql[i + 1];

    if (inComment) {
      if (char === '\n') {
        inComment = false;
        current += char;
      }
      continue;
    }

    if (inString) {
      current += char;
      if (char === "'") {
        if (next === "'") {
          current += next;
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      inComment = true;
      i += 1;
      continue;
    }

    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }

    if (char === ';') {
      statements.push(current);
      current = '';
      continue;
    }

    current += char;
  }
  statements.push(current);

  return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0);
};
