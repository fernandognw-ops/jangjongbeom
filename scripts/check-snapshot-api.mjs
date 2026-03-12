#!/usr/bin/env node
const base = process.env.BASE_URL || "http://localhost:3007";
const res = await fetch(`${base}/api/inventory/snapshot?_=${Date.now()}`, { cache: "no-store" });
const data = await res.json();
const items = data.items ?? [];
const byCat = {};
items.forEach((i) => {
  const c = (i.category || "").trim() || "(없음)";
  byCat[c] = (byCat[c] ?? 0) + 1;
});
console.log("\n[Snapshot API] category 분포:");
console.log(JSON.stringify(byCat, null, 2));
console.log("\n샘플 5건:", items.slice(0, 5).map((i) => ({ code: i.product_code, cat: i.category })));
