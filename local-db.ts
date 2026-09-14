import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AccountDatabase, Statement } from "./database";
export function localDatabase(
  path = ":memory:",
  schema: string,
): AccountDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  db.exec(schema);
  class Query implements Statement {
    constructor(
      public sql: string,
      public values: any[] = [],
    ) {}
    bind(...values: any[]) {
      return new Query(this.sql, values);
    }
    execute() {
      const statement = db.prepare(this.sql);
      if (/^\s*SELECT|\bRETURNING\b/i.test(this.sql))
        return { results: statement.all(...this.values), meta: { changes: 0 } };
      const result = statement.run(...this.values);
      return { results: [], meta: { changes: result.changes } };
    }
    async first<T>() {
      return (db.prepare(this.sql).get(...this.values) as T) || null;
    }
    async all<T>() {
      return { results: db.prepare(this.sql).all(...this.values) as T[] };
    }
    async run() {
      return this.execute();
    }
  }
  return {
    prepare: (sql) => new Query(sql),
    batch: async (statements) =>
      db.transaction(() => statements.map((s) => (s as Query).execute()))(),
  };
}
