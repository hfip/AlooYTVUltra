import express from "express";
import cors from "cors";
import { load } from "cheerio";
import fetch from "node-fetch";

const app = express();
app.use(cors());

const BASE_URL = "https://bp.alooytv13.xyz";

const MANIFEST = {
  id: "com.alooytv.ultra.v3", 
  version: "3.5.0",
  name: "AlooYTV Ultra Pro",
  description: "دعم فورد (Forward) وستريمو - بحث مباشر وكتالوجات رمضان 2026",
  logo: "https://bp.alooytv13.xyz/favicon.ico",
  types: ["series", "movie"],
  catalogs: [
    { id: "latest_alooy", name: "AlooYTV - أحدث الحلقات", type: "series", extra: [{ name: "search", isRequired: false }] },
    { id: "ramadan_2026", name: "AlooYTV - رمضان 2026", type: "series" }
  ],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["tt", "alooyultra:"] // هذا السطر هو مفتاح العمل في فورد وأومني
};

// --- محرك البحث والجلب ---
async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15" },
      timeout: 7000
    });
    return await res.text();
  } catch (e) { return ""; }
}

// --- المعالجات (Handlers) ---

app.get("/manifest.json", (req, res) => res.json(MANIFEST));

// الكتالوج والبحث (لبرنامج فورد)
app.get("/catalog/:type/:id.json", async (req, res) => {
  const query = req.query.search;
  const html = await fetchHtml(`${BASE_URL}/tv-series.html`);
  const $ = load(html);
  const metas = [];

  $("img.lazy").each((_i, el) => {
    const name = $(el).attr("alt") || "";
    if (query && !name.toLowerCase().includes(query.toLowerCase())) return;

    const href = $(el).closest("a").attr("href") || "";
    const slug = href.replace(/.*\/watch\//, "").replace(".html", "");
    const poster = $(el).attr("data-src") || $(el).attr("src");

    metas.push({
      id: `alooyultra:${slug}`,
      type: "series",
      name: name,
      poster: poster.startsWith("http") ? poster : `${BASE_URL}${poster}`,
      posterShape: "poster"
    });
  });
  res.json({ metas });
});

// روابط البث (Stream)
app.get("/stream/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  const slug = id.replace(/^(alooyultra:|tt)/, "").split(":")[0];
  
  // محاولة جلب الرابط المباشر
  const html = await fetchHtml(`${BASE_URL}/watch/${slug}.html`);
  const srcMatch = html.match(/<source\s+src="(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/i);
  
  const streams = [];
  if (srcMatch) {
    streams.push({ title: "🎬 جودة عالية - AlooYTV", url: srcMatch[1] });
  }
  streams.push({ title: "🌐 فتح في المتصفح", externalUrl: `${BASE_URL}/watch/${slug}.html` });
  
  res.json({ streams });
});

// المسار الافتراضي لـ Vercel (لا تستخدم app.listen)
app.get("/", (req, res) => res.json(MANIFEST));

export default app;
