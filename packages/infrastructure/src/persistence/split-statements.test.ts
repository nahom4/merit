import { describe, expect, it } from 'vitest';
import { splitStatements } from './split-statements.js';

describe('splitStatements', () => {
  it('splits two statements on the terminating semicolon', () => {
    expect(splitStatements('CREATE TABLE a (x INT);\nCREATE TABLE b (y INT);')).toEqual([
      'CREATE TABLE a (x INT)',
      'CREATE TABLE b (y INT)',
    ]);
  });

  it('tolerates a missing trailing semicolon on the last statement', () => {
    expect(splitStatements('CREATE TABLE a (x INT)')).toEqual(['CREATE TABLE a (x INT)']);
  });

  it('drops a comment-only file', () => {
    expect(splitStatements('-- nothing to do yet\n')).toEqual([]);
  });

  it('does not split on a semicolon inside a line comment', () => {
    // The bug this file exists for: "integer cents; SQLite has no decimal type" split a
    // CREATE TABLE in half and the migration failed with `near "SQLite": syntax error`.
    const sql = '-- cents; SQLite has no decimal type\nCREATE TABLE a (x INT);';
    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (x INT)']);
  });

  it('does not split on a semicolon inside a string literal', () => {
    expect(splitStatements("INSERT INTO a VALUES ('one; two');")).toEqual([
      "INSERT INTO a VALUES ('one; two')",
    ]);
  });

  it('keeps a doubled quote inside a string literal intact', () => {
    expect(splitStatements("INSERT INTO a VALUES ('it''s; fine');")).toEqual([
      "INSERT INTO a VALUES ('it''s; fine')",
    ]);
  });

  it('strips trailing comments from a statement', () => {
    expect(splitStatements('CREATE TABLE a (x INT); -- why\n')).toEqual(['CREATE TABLE a (x INT)']);
  });

  it('ignores empty statements produced by a doubled semicolon', () => {
    expect(splitStatements('CREATE TABLE a (x INT);;')).toEqual(['CREATE TABLE a (x INT)']);
  });
});
