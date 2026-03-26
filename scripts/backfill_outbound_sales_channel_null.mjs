#!/usr/bin/env node
/**
 * inventory_outbound.sales_channel NULL 레거시 백필 도구
 *
 * 목표:
 * - inventory_outbound에서 sales_channel IS NULL = 0건으로 만든다.
 * - 단, sales_channel 복구는 source_row_key 기반(원본 추적)으로만 수행한다.
 * - 복구 불가 row는 별도 invalid 테이블로 분리한다.
 * - invalid 테이블에 들어간 row는 category-trend 집계에서 제외되도록(코드 수정 필요) 처리한다.
 *
 * 사용:
 *   node scripts/backfill_outbound_sales_channel_null.mjs stats
 *   node scripts/backfill_outbound_sales_channel_null.mjs apply
 */
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { createHash } from "node:crypto";

const PAGE = 2000;

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)).replace(/\\/g, "/"));
const root = resolve(scriptDir, "..");
const envPath = join(root, ".env.local");

function loadEnvLocal() {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

function normCenter(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function ensurePhysicalWarehouse(wh) {
  const s = String(wh ?? "").trim();
  return s || "미지정";
}

function amountKey(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  return x.toFixed(4);
}

function buildSourceRowKey({
  sheet,
  dateYmd,
  salesChannel,
  productCode,
  quantityInt,
  amount,
  center,
}) {
  // buildUploadSourceRowKey payload와 동일
  const payload = [
    sheet,
    dateYmd,
    salesChannel,
    String(productCode ?? "").trim(),
    String(Math.trunc(quantityInt ?? 0) || 0),
    amountKey(amount),
    normCenter(center),
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function toDateYmd(v) {
  if (!v) return "";
  if (v instanceof Date) {
    // toISOString uses UTC; we only need YYYY-MM-DD
    return v.toISOString().slice(0, 10);
  }
  return String(v).trim().slice(0, 10);
}

async function main() {
  loadEnvLocal();
  const mode = String(process.argv[2] ?? "stats").toLowerCase();
  if (!["stats", "apply"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);

  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("DATABASE_URL 또는 SUPABASE_DB_URL 필요 (.env.local)");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl });

  await client.connect();
  try {
    // ---- 0) schema introspection (id/center/source_row_key 존재 확인)
    const cols = await client.query(
      `
      select column_name, data_type, udt_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'inventory_outbound'
      `
    );
    const colMap = new Map(cols.rows.map((r) => [r.column_name, r]));
    const mustHave = ["id", "product_code", "quantity", "outbound_date", "total_price", "source_row_key", "sales_channel"];
    for (const c of mustHave) {
      if (!colMap.has(c)) {
        throw new Error(`[schema] inventory_outbound column missing: ${c}`);
      }
    }
    const centerCol = colMap.has("dest_warehouse") ? "dest_warehouse" : colMap.has("outbound_center") ? "outbound_center" : null;
    if (!centerCol) throw new Error(`[schema] center column not found (dest_warehouse/outbound_center)`);

    const invalidTable = "inventory_outbound_sales_channel_invalid";

    // ---- 1) invalid table create (idempotent)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${invalidTable} (
        id bigint PRIMARY KEY,
        product_code text NOT NULL,
        outbound_date date NOT NULL,
        sales_channel_raw text,
        source_row_key text,
        attempted_match text NOT NULL,
        attempted_coupang_match boolean NOT NULL DEFAULT false,
        attempted_general_match boolean NOT NULL DEFAULT false,
        reason text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // RLS/Policies (allow select for anon/authenticated)
    // If you prefer strict RLS, adjust TO clauses.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE ${invalidTable} ENABLE ROW LEVEL SECURITY;
      EXCEPTION WHEN others THEN NULL;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        CREATE POLICY "inv_select_all" ON ${invalidTable}
          FOR SELECT
          USING (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    if (mode === "stats") {
      const nullCountRes = await client.query(`select count(*)::bigint as c from inventory_outbound where sales_channel is null`);
      const nullCount = Number(nullCountRes.rows[0]?.c ?? 0);
      console.log(`[stats] inventory_outbound sales_channel IS NULL count = ${nullCount}`);

      // ---- 2) sample matching stats (first N rows)
      const sampleN = Math.min(nullCount, 2000);
      const rowsRes = await client.query(
        `
        select id, product_code, outbound_date, quantity, total_price, ${centerCol} as center, source_row_key, sales_channel
        from inventory_outbound
        where sales_channel is null
        order by id asc
        limit $1
        `,
        [sampleN]
      );
      const rows = rowsRes.rows ?? [];

      let matchC = 0;
      let matchG = 0;
      let noMatch = 0;
      let missingSource = 0;

      for (const r of rows) {
        const quantityInt = Math.trunc(Number(r.quantity) || 0);
        const dateYmd = toDateYmd(r.outbound_date);
        const amount = Number(r.total_price) || 0;
        const center = ensurePhysicalWarehouse(r.center);
        const sourceRowKey = r.source_row_key;
        if (!sourceRowKey) {
          missingSource++;
          noMatch++;
          continue;
        }
        const keyC = buildSourceRowKey({
          sheet: "outbound",
          dateYmd,
          salesChannel: "coupang",
          productCode: r.product_code,
          quantityInt,
          amount,
          center,
        });
        const keyG = buildSourceRowKey({
          sheet: "outbound",
          dateYmd,
          salesChannel: "general",
          productCode: r.product_code,
          quantityInt,
          amount,
          center,
        });
        if (sourceRowKey === keyC) matchC++;
        else if (sourceRowKey === keyG) matchG++;
        else noMatch++;
      }

      console.log(`[stats] sampleN=${rows.length} matchC=${matchC} matchG=${matchG} noMatch=${noMatch} missingSource=${missingSource}`);
      return;
    }

    // ---- apply mode
    await client.query("BEGIN");
    try {
      let lastId = 0;
      let updatedCoupang = 0;
      let updatedGeneral = 0;
      let invalidInserted = 0;
      let totalProcessed = 0;

      // We'll update in batches by channel (and insert invalid rows).
      while (true) {
        const res = await client.query(
          `
          select id, product_code, outbound_date, quantity, total_price, ${centerCol} as center, source_row_key, sales_channel
          from inventory_outbound
          where sales_channel is null
            and id > $1
          order by id asc
          limit $2
          `,
          [lastId, PAGE]
        );
        const rows = res.rows ?? [];
        if (rows.length === 0) break;

        const idsUpdateC = [];
        const idsUpdateG = [];
        const invalidRows = [];

        for (const r of rows) {
          totalProcessed++;
          lastId = Number(r.id) || lastId;

          const quantityInt = Math.trunc(Number(r.quantity) || 0);
          const dateYmd = toDateYmd(r.outbound_date);
          const amount = Number(r.total_price) || 0;
          const center = ensurePhysicalWarehouse(r.center);
          const sourceRowKey = r.source_row_key;
          if (!sourceRowKey) {
            invalidRows.push({
              id: r.id,
              product_code: r.product_code,
              outbound_date: r.outbound_date,
              sales_channel_raw: r.sales_channel,
              source_row_key: r.source_row_key,
              attempted_match: "missing_source_row_key",
              attempted_coupang_match: false,
              attempted_general_match: false,
              reason: "no_source_row_key",
            });
            idsUpdateG.push(r.id);
            continue;
          }

          const keyC = buildSourceRowKey({
            sheet: "outbound",
            dateYmd,
            salesChannel: "coupang",
            productCode: r.product_code,
            quantityInt,
            amount,
            center,
          });
          const keyG = buildSourceRowKey({
            sheet: "outbound",
            dateYmd,
            salesChannel: "general",
            productCode: r.product_code,
            quantityInt,
            amount,
            center,
          });

          if (sourceRowKey === keyC) {
            idsUpdateC.push(r.id);
          } else if (sourceRowKey === keyG) {
            idsUpdateG.push(r.id);
          } else {
            invalidRows.push({
              id: r.id,
              product_code: r.product_code,
              outbound_date: r.outbound_date,
              sales_channel_raw: r.sales_channel,
              source_row_key: r.source_row_key,
              attempted_match: "source_key_mismatch",
              attempted_coupang_match: sourceRowKey === keyC,
              attempted_general_match: sourceRowKey === keyG,
              reason: "no_match_by_source_row_key",
            });
            // null -> 0건 목표를 위해 기본값 general로 채우되, invalid 테이블에 별도 기록한다.
            idsUpdateG.push(r.id);
          }
        }

        // Insert invalid records
        if (invalidRows.length > 0) {
          // use upsert on PK
          const valuesSql = invalidRows
            .map((r, idx) => {
              const base = idx * 10;
              return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`;
            })
            .join(",");
          const params = [];
          for (const r of invalidRows) {
            params.push(
              r.id,
              r.product_code,
              r.outbound_date,
              r.sales_channel_raw,
              r.source_row_key,
              r.attempted_match,
              r.attempted_coupang_match,
              r.attempted_general_match,
              r.reason,
              null // created_at default
            );
          }

          await client.query(
            `
            INSERT INTO ${invalidTable}
              (id, product_code, outbound_date, sales_channel_raw, source_row_key, attempted_match, attempted_coupang_match, attempted_general_match, reason, created_at)
            VALUES ${valuesSql}
            ON CONFLICT (id)
            DO UPDATE SET
              product_code = excluded.product_code,
              outbound_date = excluded.outbound_date,
              sales_channel_raw = excluded.sales_channel_raw,
              source_row_key = excluded.source_row_key,
              attempted_match = excluded.attempted_match,
              attempted_coupang_match = excluded.attempted_coupang_match,
              attempted_general_match = excluded.attempted_general_match,
              reason = excluded.reason,
              created_at = excluded.created_at
            `,
            params
          );
          invalidInserted += invalidRows.length;
        }

        // updates
        if (idsUpdateC.length > 0) {
          await client.query(
            `update inventory_outbound set sales_channel = 'coupang' where id = ANY($1::bigint[])`,
            [idsUpdateC]
          );
          updatedCoupang += idsUpdateC.length;
        }
        if (idsUpdateG.length > 0) {
          await client.query(
            `update inventory_outbound set sales_channel = 'general' where id = ANY($1::bigint[])`,
            [idsUpdateG]
          );
          updatedGeneral += idsUpdateG.length;
        }

        console.log(
          `[apply] processed batch rows=${rows.length} totalProcessed=${totalProcessed} updC=${updatedCoupang} updG=${updatedGeneral} invalidInserted=${invalidInserted}`
        );
      }

      const afterNullRes = await client.query(`select count(*)::bigint as c from inventory_outbound where sales_channel is null`);
      const afterNull = Number(afterNullRes.rows[0]?.c ?? 0);
      console.log(`[apply] done. updatedCoupang=${updatedCoupang} updatedGeneral=${updatedGeneral} invalidInserted=${invalidInserted} afterNull=${afterNull}`);

      if (afterNull !== 0) {
        throw new Error(`after backfill, sales_channel still has NULL rows: ${afterNull}`);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[backfill_outbound_sales_channel_null]", e?.message ?? e);
  process.exit(1);
});

