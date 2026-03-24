const base = "https://jangjongbeom.vercel.app";
const urls = [
  `${base}/api/category-trend?debug=1&month=2026-03&_t=${Date.now()}`,
  `${base}/api/inventory/summary?debug=1&_t=${Date.now()}`,
  `${base}/api/inventory/data?debug=1&_t=${Date.now()}`,
];

for (const u of urls) {
  const r = await fetch(u, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    j = { nonJson: text.slice(0, 300) };
  }
  const keys = j && typeof j === "object" ? Object.keys(j) : [];
  console.log(
    JSON.stringify(
      {
        url: u,
        status: r.status,
        topLevelKeys: keys,
        serverInfo: j?.serverInfo ?? null,
        hasMonthKeyDebug: !!j?.monthKeyDebug || !!j?.outboundValueDebug?.monthKeyDebug,
        outboundValueDebugKeys: j?.outboundValueDebug ? Object.keys(j.outboundValueDebug) : [],
        meta: j?._meta ?? null,
        error: j?.error ?? null,
      },
      null,
      2
    )
  );
}
