---
id: database-query-review
name: Database Query Review
description: Review database queries for N+1 problems, missing indexes, inefficient joins, transaction patterns, and connection management
trigger: When asked to review database queries, find N+1 problems, optimize SQL, check indexes, or assess database performance
relatedTools:
  - searchFiles
  - readFile
  - scanIssues
lastReviewed: "2026-03-08"
reviewCycleDays: 180
---

# Database Query Review

## Purpose

Performs a systematic review of database access patterns across the codebase, identifying N+1 query problems, missing indexes, unbounded queries, long-running transactions, and connection management issues. The analysis traces database calls from their invocation point through ORM abstractions to the actual queries executed, classifying findings by their production impact on latency, throughput, and data integrity. The user receives a prioritized list of database performance and correctness findings with exact locations, measured metrics, and concrete query optimizations.

## Prerequisites

Ensure the `searchFiles` tool is available for locating database access patterns across the codebase. The `readFile` tool is required for inspecting query implementations, schema definitions, and migration files. The `scanIssues` tool helps surface common database-related anti-patterns. Identify the ORM or database client in use (Prisma, Drizzle, Knex, raw SQL, Mongoose, etc.) before beginning analysis.

## Methodology

Follow this structured approach for every database query review. Complete each phase in order.

### Phase 1: Query Inventory

1. Call `getProjectOverview` to understand the project's database layer and ORM choice
2. Use `searchFiles` to locate all database access points:
   - **Prisma**: search for `prisma.`, `$queryRaw`, `$executeRaw`, `$transaction`
   - **Drizzle**: search for `db.select`, `db.insert`, `db.update`, `db.delete`, `db.query`
   - **Knex**: search for `knex(`, `.where(`, `.join(`, `.raw(`
   - **Raw SQL**: search for `query(`, `execute(`, `sql`, template literal SQL
   - **Mongoose**: search for `.find(`, `.findOne(`, `.aggregate(`, `.populate(`
3. Read schema definitions (Prisma schema, migration files, Mongoose models)
4. Catalog all database operations by type: read, write, aggregate, transaction
5. Map which API routes and server actions trigger database calls

### Phase 2: N+1 Detection

1. Use `searchFiles` to find queries inside loops:
   - Search for database calls inside `.map(`, `.forEach(`, `for (`, `for await (`
   - Search for `.findUnique` or `.findFirst` inside iteration (Prisma N+1)
   - Search for `.populate()` inside loops (Mongoose N+1)
   - Search for sequential `await` in data transformation pipelines
2. For each detected pattern, assess:
   - What is the expected iteration count? (fixed small set vs unbounded user data)
   - Is there a batch alternative available? (`findMany`, `IN (...)`, `Promise.all`)
   - Is the query cached, reducing the real cost?
3. Trace the call chain — sometimes the loop is in a parent function calling a helper that queries

#### N+1 Detection Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| Database call inside loop (user-facing path) | Any with > 10 potential iterations | Critical — batch immediately |
| Database call inside loop (user-facing path) | Any with 3-10 potential iterations | High — batch when possible |
| Database call inside loop (background job) | > 100 iterations without batching | High — use batch or cursor |
| Database call inside loop (background job) | 10-100 iterations | Medium — batch for efficiency |
| Sequential awaits for independent queries | > 3 queries | Medium — parallelize with `Promise.all` |

**Verification**: Before flagging an N+1, check if the loop has a fixed, small upper bound (e.g., iterating over 3 enum values). A loop that always runs 3 times is not an N+1 problem — it's 3 predictable queries.

### Phase 3: Index Analysis

1. Read schema definitions and migration files with `readFile`
2. Use `searchFiles` to find all query filter patterns:
   - `WHERE` clauses in raw SQL
   - `.where(`, `.findMany({ where: })` in ORMs
   - `.orderBy(`, `ORDER BY` clauses
   - `.join(`, `JOIN ... ON` clauses
3. For each filtered/sorted/joined column, check:
   - Is there an index defined in the schema or migrations?
   - Is the index type appropriate? (B-tree for equality/range, GIN for full-text, composite for multi-column)
   - Are there composite indexes for queries that filter on multiple columns?
4. Flag queries on high-traffic routes that filter on unindexed columns

**Verification**: Before flagging a missing index, check the table's expected size. For tables with < 1000 rows, a sequential scan is often faster than an index lookup. Also check if the column has low cardinality (e.g., boolean or enum) — indexes on low-cardinality columns provide minimal benefit.

### Phase 4: Transaction Patterns

1. Use `searchFiles` to find transaction usage:
   - Prisma: `$transaction`, `prisma.$transaction([...])`
   - Drizzle: `db.transaction()`
   - Knex: `knex.transaction()`
   - Raw: `BEGIN`, `COMMIT`, `ROLLBACK`
2. Check for transaction issues:
   - **Missing transactions**: Multiple related writes without atomicity guarantees
   - **Long-running transactions**: Transactions that include API calls, file I/O, or heavy computation between queries
   - **Nested transactions**: Savepoints or transaction-within-transaction patterns
   - **Read-only transactions**: Overhead of transactions used for read-only operations
3. Check that error paths properly rollback:
   - Does the catch block call `rollback` or does the ORM handle it automatically?
   - Are there code paths that exit the transaction block without completing?

#### Transaction Pattern Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| Non-DB operations inside transaction | Any I/O (API call, file read) | High — move outside transaction |
| Transaction with > 5 queries | N/A | Review — can queries be batched? |
| Related writes without transaction | > 2 writes that must be atomic | High — wrap in transaction |
| Transaction holding time estimate | > 5 seconds | Critical — long-running risk (locks) |

**Verification**: Before flagging missing transactions, confirm the writes are actually related. Two independent writes to different tables for different features don't need a transaction — atomicity is only required when partial completion would leave data inconsistent.

### Phase 5: Connection Management

1. Use `searchFiles` to find database connection setup:
   - Search for connection configuration: `DATABASE_URL`, `createPool`, `new PrismaClient`, `new Pool`
   - Search for connection options: `connectionLimit`, `pool`, `max`, `idleTimeoutMillis`
2. Check connection patterns:
   - **Global client**: Is the database client instantiated once and reused? (Singleton pattern)
   - **Per-request clients**: Are new clients created per request? (Leak risk in serverless)
   - **Connection pooling**: Is pooling configured? Are pool sizes appropriate for the deployment target?
3. Check for serverless/edge considerations:
   - Prisma: Is `@prisma/client/edge` or connection pooling (PgBouncer, Prisma Accelerate) configured?
   - Are cold start connection costs mitigated?

**Verification**: Before flagging connection issues, check the deployment target. A traditional server with persistent processes has different connection management needs than a serverless function that spins up and down.

### Phase 6: Data Volume Safety

1. Use `searchFiles` to find queries that may return unbounded results:
   - Search for `findMany`, `SELECT *`, `.find()` without `LIMIT` or `take`
   - Search for aggregate operations on potentially large tables
2. Check for pagination implementation:
   - Is cursor-based or offset-based pagination used for list endpoints?
   - Is there a maximum page size enforced? (Prevent `?limit=999999`)
   - Are COUNT queries used efficiently? (Approximate counts for large tables)
3. Check for large data processing patterns:
   - Are large result sets processed in memory or streamed?
   - Are batch operations chunked to avoid memory pressure?
   - Is there a cursor/stream pattern for exports or reports?

#### Data Volume Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| `findMany`/`SELECT` without `take`/`LIMIT` | Any on user-data table | Medium — add limit |
| Maximum allowed page size | > 100 rows | Review — may cause slow responses |
| `SELECT *` on table with > 10 columns | Any | Low — select specific columns |
| In-memory processing of > 1000 rows | Any | Review — consider streaming |

### Phase 7: Report

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: N+1, Missing Index, Transaction, Connection, or Data Volume
3. **Location**: Exact file path and line reference
4. **Description**: What the database issue is
5. **Query Impact**: Estimated latency or throughput effect
6. **Remediation**: Specific query optimization with before/after code

Provide an overall summary:

- Total findings by severity and category
- Database access pattern assessment (well-optimized, needs tuning, needs redesign)
- Top 3 highest-impact query optimizations
- N+1 hotspots by feature area
- Positive patterns: well-optimized queries and proper batching worth preserving

## Severity Classification

| Severity | Criteria | Example |
| ---------- | ---------- | --------- |
| **Critical** | N+1 on user-facing request with unbounded iteration, long-running transaction blocking writes | `findUnique` inside `.map()` over user's repositories (could be 100+) |
| **High** | Missing index on high-traffic query, multiple related writes without transaction | API list endpoint filtering on unindexed `createdAt` column |
| **Medium** | Unbounded `SELECT` without `LIMIT`, sequential queries that could be parallelized | `findMany()` returning all rows when only first 20 are displayed |
| **Low** | `SELECT *` when specific columns suffice, query optimization for low-traffic endpoint | Admin dashboard query selecting all 15 columns when 3 are displayed |
| **Informational** | Alternative query patterns, denormalization opportunities, caching suggestions | Repeated JOIN could be replaced with a materialized view |

## Example Output

````markdown
### Finding: N+1 Query in Repository Analysis

- **Severity**: Critical
- **Category**: N+1
- **Location**: `lib/repository/analyze.ts` line 67
- **Description**: The analysis function fetches each file's metadata individually inside a `.map()` loop:
  ```ts
  const results = await Promise.all(
    files.map(async (file) => {
      const metadata = await prisma.fileMetadata.findUnique({
        where: { path_repoId: { path: file.path, repoId } },
      });
      return { ...file, metadata };
    })
  );
  ```
  For a repository with 200 files, this executes 200 individual SELECT queries. Even with `Promise.all`, the database connection pool saturates and total latency scales linearly with file count.
- **Query Impact**: ~200 queries × 2ms each = 400ms minimum. Connection pool of 10 means 20 sequential batches = potential timeout on large repos.
- **Remediation**: Batch the query with `findMany` and join in application code:
  ```ts
  const allMetadata = await prisma.fileMetadata.findMany({
    where: {
      repoId,
      path: { in: files.map((f) => f.path) },
    },
  });
  const metadataByPath = new Map(allMetadata.map((m) => [m.path, m]));
  const results = files.map((file) => ({
    ...file,
    metadata: metadataByPath.get(file.path) ?? null,
  }));
  ```
  This reduces 200 queries to 1 query with an `IN` clause.
````

## Common False Positives

Skip or downgrade these patterns — they look like database issues but are acceptable:

1. **Seed and migration scripts**: Scripts that run once to populate or transform data intentionally use loops, unbounded selects, and lack indexes — they are not production query paths
2. **Admin-only endpoints with low traffic**: A dashboard endpoint accessed by 2 internal users doesn't need the same optimization as a user-facing API called 10,000 times/day
3. **Intentional full-table scans for analytics**: Analytical queries that aggregate entire tables (daily reports, export jobs) are expected to scan fully — they should run on read replicas, not be optimized away
4. **ORM eager loading mistaken for N+1**: Prisma `include` and Mongoose `.populate()` generate JOINs or batched queries internally — they are not N+1 despite appearing to load related data
5. **In-memory SQLite for tests**: Test databases using SQLite don't need connection pooling, indexes, or production-grade optimization — flag only if test patterns leak into production code
6. **Short-lived CLI tools and scripts**: One-off scripts that process data and exit don't need connection pooling or long-lived connection management

## Related Skills

- For overall API performance and response time optimization, load `performance-analysis`
- For pagination and list endpoint design, load `api-design-review`
- For schema design and data modeling decisions, load `architecture-analysis`
