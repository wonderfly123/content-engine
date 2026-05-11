/**
 * Minimal in-memory fake of the slice of the Drizzle client used by the
 * pipeline modules. We only model the chains the production code uses:
 *
 *   db.insert(table).values(rows).returning(cols?)
 *   db.update(table).set(patch).where(predicate)
 *   db.select(cols?).from(table)[.where(p)][.orderBy(...)][.limit(n)]
 *   db.execute(sql) — opaque, callers pass a fn override
 *
 * Each "table" is just a string-keyed array of row objects. `where`
 * predicates are not evaluated; tests pre-arrange the store so the first
 * matching row is returned. This keeps the fake tiny while still exercising
 * the real pipeline call sites end-to-end.
 */

import { vi } from "vitest";

export type Row = Record<string, unknown>;

export interface FakeDB {
  store: Map<string, Row[]>;
  exec: ReturnType<typeof vi.fn>;
  insert: (table: TableHandle) => InsertBuilder;
  update: (table: TableHandle) => UpdateBuilder;
  select: (cols?: Record<string, unknown>) => SelectBuilder;
  execute: (...args: unknown[]) => Promise<unknown>;
}

export interface TableHandle {
  // Drizzle exposes pgTable instances; we only need the name so the fake can
  // bucket rows by table identity. The pipelines pass the Drizzle table
  // objects which carry a Symbol(name); we normalise to a string here.
  [k: string]: unknown;
}

export interface InsertBuilder {
  values: (rowOrRows: Row | Row[]) => InsertBuilder;
  returning: (cols?: Record<string, unknown>) => Promise<Row[]>;
}
export interface UpdateBuilder {
  set: (patch: Row) => UpdateBuilder;
  where: (predicate?: unknown) => Promise<void>;
}
export interface SelectBuilder {
  from: (table: TableHandle) => SelectBuilder;
  where: (predicate?: unknown) => SelectBuilder;
  orderBy: (...args: unknown[]) => SelectBuilder;
  limit: (n: number) => Promise<Row[]>;
  // also awaitable directly
  then: <T>(
    onFulfilled?: ((value: Row[]) => T | PromiseLike<T>) | null,
  ) => Promise<T>;
  innerJoin: (...args: unknown[]) => SelectBuilder;
}

function tableName(t: TableHandle): string {
  // Drizzle stores the table name on Symbol.for("drizzle:Name") or a
  // top-level `name` getter. We fall back to a JSON tag for fakes that pass
  // a `{ name: "x" }` literal.
  const sym = Object.getOwnPropertySymbols(t).find(
    (s) => s.description === "drizzle:Name" || s.description === "Name",
  );
  if (sym) return String((t as Record<symbol, unknown>)[sym]);
  if (typeof t.name === "string") return t.name;
  return "_unknown";
}

export function makeFakeDb(initial: Record<string, Row[]> = {}): FakeDB {
  const store = new Map<string, Row[]>(
    Object.entries(initial).map(([k, v]) => [k, v.slice()]),
  );
  const exec = vi.fn().mockResolvedValue({ rows: [] });

  let pendingSelectFilter: ((r: Row) => boolean) | null = null;
  let pendingSelectTable: string | null = null;
  let pendingSelectOrder: ((a: Row, b: Row) => number) | null = null;

  const db: FakeDB = {
    store,
    exec,
    insert(table) {
      const tName = tableName(table);
      let staged: Row[] = [];
      const builder: InsertBuilder = {
        values(rowOrRows) {
          staged = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          return builder;
        },
        async returning() {
          const bucket = store.get(tName) ?? [];
          const out: Row[] = [];
          for (const r of staged) {
            const withId = { id: r.id ?? cryptoRandomId(), ...r };
            bucket.push(withId);
            out.push(withId);
          }
          store.set(tName, bucket);
          return out;
        },
      };
      return builder;
    },
    update(table) {
      const tName = tableName(table);
      let patch: Row = {};
      const builder: UpdateBuilder = {
        set(p) {
          patch = p;
          return builder;
        },
        async where() {
          const bucket = store.get(tName) ?? [];
          // Apply patch to every row in bucket (test pre-arranges single match).
          for (const row of bucket) Object.assign(row, patch);
          store.set(tName, bucket);
        },
      };
      return builder;
    },
    select() {
      const builder: SelectBuilder = {
        from(table) {
          pendingSelectTable = tableName(table);
          return builder;
        },
        where() {
          return builder;
        },
        orderBy(...args) {
          // Honour a single direct comparator if provided as a function.
          if (typeof args[0] === "function")
            pendingSelectOrder = args[0] as (a: Row, b: Row) => number;
          return builder;
        },
        innerJoin() {
          return builder;
        },
        async limit(n) {
          const tn = pendingSelectTable ?? "_unknown";
          let rows = (store.get(tn) ?? []).slice();
          if (pendingSelectFilter) rows = rows.filter(pendingSelectFilter);
          if (pendingSelectOrder) rows.sort(pendingSelectOrder);
          pendingSelectFilter = null;
          pendingSelectOrder = null;
          pendingSelectTable = null;
          return rows.slice(0, n);
        },
        then(onFulfilled) {
          const tn = pendingSelectTable ?? "_unknown";
          let rows = (store.get(tn) ?? []).slice();
          if (pendingSelectFilter) rows = rows.filter(pendingSelectFilter);
          if (pendingSelectOrder) rows.sort(pendingSelectOrder);
          pendingSelectFilter = null;
          pendingSelectOrder = null;
          pendingSelectTable = null;
          return Promise.resolve(rows).then(onFulfilled);
        },
      };
      return builder;
    },
    execute: (...args) => exec(...args),
  };
  return db;
}

function cryptoRandomId(): string {
  // Avoid leaning on globalThis.crypto in Node test envs.
  return (
    Math.random().toString(36).slice(2, 10) +
    "-" +
    Date.now().toString(36)
  );
}
