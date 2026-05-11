import express from "express";
import cors from "cors";
import { load } from "cheerio";
import fetch from "node-fetch";

const PORT = process.env.PORT || 7000;
const BASE_URL = "https://bp.alooytv13.xyz";
const IMAGE_BASE = "https://bp.alooytv13.xyz";

// ─── المانيفست المطور لبرنامج Forward ───────────────────────────────────────
const MANIFEST = {
  id: "com.alooytv.ultra.standalone", // معرف فريد جديد لمنع التعارض
  version: "2.1.0",
  name: "AlooYTV Ultra",
  description: "نسخة الترا المستقلة - دعم البحث العالمي وبرنامج Forward - رمضان 2026",
  logo: "https://bp.alooytv13.xyz/favicon.ico",
  types: ["series", "movie"],
  catalogs: [
    {
      type: "series",
      id: "alooy_search",
      name: "بحث AlooYTV",
      extra: [{ name: "search", isRequired: false }] // لتمكين البحث في Forward
    },
    { type: "series", id: "latest", name: "أحدث الحلقات" },
    { type: "series", id: "ramadan-2026", name: "رمضان 2026 ★" }
  ],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["tt", "alooyultra:"] // دعم tt للظهور عند البحث العالمي
};

// ─── وظائف البحث والجلب ──────────────────────────────────────────────────────
async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        Referer: BASE_URL,
      },
      timeout: 8000
    });
    return await res.text();
  } catch (err) { return ""; }
}

async function searchSite(query) {
  if (!query) return [];
  const searchUrl = `${BASE_URL}/tv-series.html`; 
  const html = await fetchHtml(searchUrl);
  const $ = load(html);
  const results = [];

  $("img").each((_i, el) => {
    const name = $(el).attr("alt") || "";
    if (name.toLowerCase().includes(query.toLowerCase())) {
      const href = $(el).closest("a").attr("href") || "";
      if (href.includes("/watch/")) {
        const slug = href.replace(/.*\/watch\//, "").replace(".html", "");
        results.push({
          id: `alooyultra:${slug}`,
          name: name,
          type: href.includes("tv-series") ? "series" : "movie",
          poster: $(el).attr("data-src") || $(el).attr("src") || ""
        });
      }
    }
  });
  return results;
}

// ─── بناء السيرفر ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());

// الرابط الرئيسي والمانيفست
app.get("/", (_req, res) => res.send("AlooYTV Ultra Addon is Active"));
app.get("/manifest.json", (_req, res) => res.json(MANIFEST));

// معالج الكتالوج والبحث (لحل مشكلة برنامج فورد)
app.get("/catalog/:type/:id.json", async (req, res) => {
  const query = req.query.search;
  if (query) {
    const results = await searchSite(query);
    return res.json({ metas: results });
  }
  // يمكنك إضافة منطق جلب التصنيفات الافتراضية هنا
  res.json({ metas: [] });
});

// معالج الـ Meta
app.get("/meta/:type/:id.json", async (req, res) => {
  const { id } = req.params;
  const slug = id.replace(/^(alooyultra:|tt)/, "");
  res.json({
    meta: {
      id: id,
      type: req.params.type,
      name: "مشغل AlooYTV Ultra",
      poster: "https://bp.alooytv13.xyz/favicon.ico",
      background: "https://bp.alooytv13.xyz/favicon.ico",
    }
  });
});

// معالج الـ Stream (يستخرج روابط البث فوراً)
app.get("/stream/:type/:id.json", async (req, res) => {
  const { id } = req.params;
  let slug = id.replace(/^(alooyultra:|tt)/, "");
  let key = "";

  if (slug.includes(":")) {
    const parts = slug.split(":");
    slug = parts[0];
    key = parts[1];
  }

  const url = `${BASE_URL}/watch/${slug}.html${key ? `?key=${key}` : ""}`;
  const html = await fetchHtml(url);
  const streams = [];

  const srcMatch = html.match(/<source\s+src="(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/i);
  if (srcMatch) {
    streams.push({
      name: "AlooYTV Ultra",
      title: "🎬 جودة مباشرة عالية",
      url: srcMatch[1],
    });
  }

  streams.push({
    name: "AlooYTV Ultra",
    title: "🌐 فتح في المتصفح الرسمي",
    externalUrl: url
  });

  res.json({ streams });
});

app.listen(PORT);
