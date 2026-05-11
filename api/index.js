import express from "express";
import cors from "cors";
import { load } from "cheerio";
import fetch from "node-fetch";

const PORT = process.env.PORT || 7000;
const BASE_URL = "https://bp.alooytv13.xyz";
const IMAGE_BASE = "https://bp.alooytv13.xyz";

// ─── المانيفست المطور لبرنامج فورد وأومني ────────────────────────────────────
const MANIFEST = {
  id: "com.alooytv.ultra.final", // معرف فريد جديد لضمان تحديث الإضافة في التطبيقات
  version: "3.5.0",
  name: "AlooYTV Ultra Pro",
  description: "دعم كامل لبرنامج فورد وستريمو - رمضان 2026 - بحث وكتالوجات شاملة",
  logo: "https://bp.alooytv13.xyz/favicon.ico",
  types: ["series", "movie"],
  catalogs: [
    { 
      id: "latest_episodes", 
      name: "أحدث الحلقات", 
      type: "series", 
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }] 
    },
    { id: "ramadan_2026", name: "رمضان 2026 ★", type: "series" },
    { id: "turki_series", name: "مسلسلات تركية", type: "series" },
    { id: "arabic_series", name: "مسلسلات عربية", type: "series" }
  ],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["tt", "alooyultra:"] // إضافة tt ضرورية للظهور في واجهة فورد الرئيسية
};

// ─── وظائف الجلب والبحث ──────────────────────────────────────────────────────
async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15",
        Referer: BASE_URL,
      },
      timeout: 8000
    });
    return await res.text();
  } catch (err) { return ""; }
}

async function getItems(url, query = "") {
  const html = await fetchHtml(url);
  if (!html) return [];
  const $ = load(html);
  const items = [];

  $("img").each((_i, el) => {
    const name = $(el).attr("alt") || "";
    if (query && !name.toLowerCase().includes(query.toLowerCase())) return;

    const dataSrc = $(el).attr("data-src") || $(el).attr("src") || "";
    if (!dataSrc.includes("/uploads/video_thumb/")) return;

    const href = $(el).closest("a").attr("href") || "";
    const slug = href.replace(/.*\/watch\//, "").replace(".html", "");
    
    if (slug && !items.find(i => i.slug === slug)) {
      items.push({
        id: `alooyultra:${slug}`,
        name: name,
        type: "series",
        poster: dataSrc.startsWith("http") ? dataSrc : `${IMAGE_BASE}${dataSrc}`,
        slug: slug
      });
    }
  });
  return items;
}

// ─── بناء السيرفر ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());

app.get("/manifest.json", (_req, res) => res.json(MANIFEST));

// معالج الكتالوج والبحث
app.get("/catalog/:type/:id.json", async (req, res) => {
  const { id } = req.params;
  const query = req.query.search;
  
  let url = `${BASE_URL}/tv-series.html`;
  if (id === "ramadan_2026") url = `${BASE_URL}/genre/ramadan-arabi-2026.html`;
  if (id === "turki_series") url = `${BASE_URL}/genre/turki.html`;
  if (id === "arabic_series") url = `${BASE_URL}/genre/arabic.html`;

  try {
    const items = await getItems(url, query);
    const metas = items.map(i => ({
      id: i.id,
      type: i.type,
      name: i.name,
      poster: i.poster,
      posterShape: "poster"
    }));
    res.json({ metas });
  } catch { res.json({ metas: [] }); }
});

// معالج الـ Meta (لجلب قائمة الحلقات)
app.get("/meta/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  const slug = id.replace(/^(alooyultra:|tt)/, "").split(":")[0];
  
  const html = await fetchHtml(`${BASE_URL}/watch/${slug}.html`);
  const $ = load(html);
  
  const episodes = [];
  $("a[href*='key=']").each((_i, el) => {
    const key = $(el).attr("href").match(/key=([^&]+)/)?.[1];
    const text = $(el).text().trim();
    if (key) {
      episodes.push({
        id: `${id}:${key}`,
        title: text.includes("الحلقة") ? text : `الحلقة ${episodes.length + 1}`,
        season: 1,
        episode: episodes.length + 1,
        released: new Date().toISOString()
      });
    }
  });

  res.json({
    meta: {
      id: id,
      type: req.params.type,
      name: $("h1").text().trim() || "AlooYTV Ultra Content",
      poster: $("img[src*='/uploads/video_thumb/']").first().attr("src") || "",
      videos: episodes.length > 0 ? episodes : [{ id: id, title: "تشغيل الفيلم/الحلقة" }]
    }
  });
});

// معالج الـ Stream (استخراج الروابط المباشرة)
app.get("/stream/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  const cleanId = id.replace(/^(alooyultra:|tt)/, "");
  const [slug, key] = cleanId.split(":");

  const url = `${BASE_URL}/watch/${slug}.html${key ? `?key=${key}` : ""}`;
  try {
    const html = await fetchHtml(url);
    const streams = [];

    // البحث عن روابط m3u8 أو mp4 في الكود
    const directMatch = html.match(/<source\s+src="(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/i);
    if (directMatch) {
      streams.push({
        name: "AlooYTV Ultra",
        title: "🎬 جودة عالية مباشرة",
        url: directMatch[1]
      });
    }

    // إضافة رابط المتصفح كخيار احتياطي
    streams.push({
      name: "AlooYTV Ultra",
      title: "🌐 مشاهدة عبر الموقع",
      externalUrl: url
    });

    res.json({ streams });
  } catch { res.json({ streams: [] }); }
});

app.get("/", (_req, res) => res.send("AlooYTV Ultra is Active"));

export default app;
