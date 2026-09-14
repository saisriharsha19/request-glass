export interface Statement {
  bind(...values: any[]): Statement;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface AccountDatabase {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<any[]>;
}
