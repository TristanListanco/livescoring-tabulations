// Checks that supabase/schema.sql and supabase/migrations/ agree, on a throwaway Postgres (PGlite) in this process:
//
// - A database set up from the base branch's schema.sql, with this branch's new migrations applied, ends up the same
//   as one set up from this branch's schema.sql. A live database is updated by the migrations and a new one is created
//   from schema.sql, so a difference means the two drift apart: a change in one and not the other.
// - Each new migration can run twice without failing, as they all promise ("Safe to run again"): a migration already
//   applied by hand runs again when the pipeline applies it.
// - schema.sql can run twice, too, and on a brand-new database each new migration does nothing.
// - No migration already on the base was changed: once merged, it may have run on a database, which won't run it again,
//   so a change to it never arrives there (put it in a new migration).
//
// Usage: node scripts/check-migrations.mjs [base]    base: a git ref (default origin/main)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const base = process.argv[2] || "origin/main";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

// What a Supabase project has before schema.sql: the API roles, the realtime publication and storage's buckets table.
const SUPABASE = `
create role anon; create role authenticated; create role service_role;
create publication supabase_realtime;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
`;

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE);
  return db;
}

/** Everything the app relies on in the public schema, in a form two databases can be compared by. */
async function snapshot(db) {
  // Comments and spacing inside a function don't change what it does.
  const tidy = (sql) => (sql ?? "").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
  const rows = async (label, sql) => (await db.query(sql)).rows.map((r) => `${label}: ${Object.values(r).map((v) => tidy(String(v))).join(" | ")}`);
  const lines = [
    ...(await rows("column", `select table_name, column_name, data_type, udt_name, is_nullable, coalesce(column_default, '') from information_schema.columns where table_schema = 'public' order by 1, 2`)),
    ...(await rows("constraint", `select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)),
    ...(await rows("index", `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`)),
    ...(await rows("trigger", `select tgrelid::regclass::text, tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'storage.%' order by 1, 2`)),
    ...(await rows("function", `select p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1, 2`)),
    ...(await rows("policy", `select tablename, policyname, cmd, array_to_string(roles, ','), coalesce(qual, ''), coalesce(with_check, '') from pg_policies where schemaname in ('public', 'storage') order by 1, 2`)),
    ...(await rows("row security", `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)),
    ...(await rows("grant", `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3`)),
    ...(await rows("realtime", `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)),
    ...(await rows("bucket", `select id, public from storage.buckets order by 1`)),
  ];
  return lines;
}

let failed = false;
const check = async (label, run) => {
  try {
    await run();
    console.log(`ok    ${label}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL  ${label}\n      ${String(error.message ?? error).split("\n").join("\n      ")}`);
  }
};

const schema = readFileSync("supabase/schema.sql", "utf8");
const baseSchema = git("show", `${base}:supabase/schema.sql`);
const baseFiles = new Set(git("ls-tree", "--name-only", `${base}:supabase/migrations`).split("\n").filter(Boolean));
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const added = migrations.filter((f) => !baseFiles.has(f));
const sql = (file) => readFileSync(`supabase/migrations/${file}`, "utf8");
console.log(`Base ${base}; new migrations: ${added.length ? added.join(", ") : "none"}`);

await check("no migration already on the base was changed", async () => {
  const changed = migrations.filter((f) => baseFiles.has(f) && git("show", `${base}:supabase/migrations/${f}`) !== sql(f));
  if (changed.length) throw new Error(`${changed.join(", ")}: already merged, so a database that ran it won't see the change. Put it in a new migration.`);
});

// The base's database, brought up to date by the new migrations, each run twice.
const updated = await database();
await check(`the base's schema.sql`, () => updated.exec(baseSchema));
for (const file of added) {
  await check(file, () => updated.exec(sql(file)));
  await check(`${file} again`, () => updated.exec(sql(file)));
}

// A new database, from this branch's schema.sql (twice), which the new migrations then leave as it is.
const created = await database();
await check("this branch's schema.sql", () => created.exec(schema));
await check("this branch's schema.sql again", () => created.exec(schema));
const before = await snapshot(created);
for (const file of added) await check(`${file} after schema.sql`, () => created.exec(sql(file)));
await check("the new migrations change nothing on a database created from schema.sql", async () => {
  const after = await snapshot(created);
  const changed = after.filter((l) => !before.includes(l)).concat(before.filter((l) => !after.includes(l)).map((l) => `(gone) ${l}`));
  if (changed.length) throw new Error(changed.slice(0, 20).join("\n"));
});

// The two databases match.
const fresh = await database();
await fresh.exec(schema);
await check("updated by the migrations = created from schema.sql", async () => {
  const [a, b] = [await snapshot(updated), await snapshot(fresh)];
  const onlyMigrated = a.filter((l) => !b.includes(l)).map((l) => `only after the migrations: ${l}`);
  const onlySchema = b.filter((l) => !a.includes(l)).map((l) => `only in schema.sql:         ${l}`);
  const differences = [...onlyMigrated, ...onlySchema];
  if (differences.length) throw new Error(`${differences.length} differences\n${differences.slice(0, 30).join("\n")}`);
});

process.exit(failed ? 1 : 0);
