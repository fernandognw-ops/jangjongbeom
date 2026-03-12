#!/usr/bin/env node
/**
 * snapshot API 응답에서 category 분포 확인
 * 사용법: npm run dev 실행 후, 다른 터미널에서 node scripts/check-snapshot-categories.mjs
 */
const res = await fetch("http://localhost:3000/api/inventory/snapshot");
const data = await res.json();
const items = data.items ?? [];
const byCat = {};
let withCat = 0;
let noCat = 0;
for (const i of items) {
  const c = i.category ?? "";
  if (c && c !== "기타") {
    withCat++;
    byCat[c] = (byCat[c] ?? 0) + 1;
  } else {
    noCat++;
  }
}
console.log("총 items:", items.length);
console.log("category 있음 (기타 제외):", withCat);
console.log("category 없음/기타:", noCat);
console.log("카테고리별:", JSON.stringify(byCat, null, 2));
console.log("샘플 (처음 3건):", items.slice(0, 3).map((i) => ({ code: i.product_code, cat: i.category })));
