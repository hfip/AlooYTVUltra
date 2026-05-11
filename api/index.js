import express from "express";
import cors from "cors";
import { load } from "cheerio";
import fetch from "node-fetch";

const PORT = process.env.PORT || 7000;
const BASE_URL = "https://bp.alooytv13.xyz";
const IMAGE_BASE = "https://bp.alooytv13.xyz";
const DEFAULT_THUMB = `${IMAGE_BASE}/uploads/default_image/blank_thumbnail.jpg`;

// ─── المانيفست المطور لبرنامج Forward وستريمو ──────────────────────────────────
const MANIFEST = {
  id: "com.alooytv.ultra.official", // معرف فريد جديد تماماً لمنع التعارض
  version: "3.0.0",
  name: "AlooYTV Ultra",
  description: "نسخة الترا - رمضان 2026 - دعم كامل للبحث والكتالوجات وبرنامج Forward",
  logo: "https://bp.alooytv13.xyz/favicon.ico",
  types: ["series", "movie"],
  catalogs: [
    { id: "latest", name: "أحدث الحلقات", type: "series", extra: [{ name: "search", isRequired: false }] },
    { id: "ramadan-2026", name: "رمضان 2026 ★", type: "series" },
    { id: "turki", name: "مسلسلات تركية", type: "series" }
  ],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["alooyultra:", "tt"], // دعم tt ضروري جداً لبرنامج فورد
};

// ─── الكاش ووظائف الجلب ──────────────────────────────────────────────────────
const pageCache = new Map();
const PAGE_TTL = 3 * 60 * 1000;

async function fetchHtml(url) {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL) return cached.html;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        Referer: BASE_URL,
      },
      timeout: 8000
    });
    const html = await res.text();
    pageCache.set(url, { html, ts: Date.now() });
    return html;
  } catch (err) { return ""; }
}

// ─── السكرابر (Scraper) المستخلص من كودك الناجح ────────────────────────────────
async function getCatalogItems(catalogId, query = "") {
  // تحديد الرابط بناءً على النوع أو البحث
  let url = `${BASE_URL}/tv-series.html`;
  if (catalogId === "ramadan-2026") url = `${BASE_URL}/genre/ramadan-arabi-2026.html`;
  if (catalogId === "turki") url = `${BASE_URL}/genre/turki.html`;
  
  const html = await fetchHtml(url);
  if (!html) return [];
  const $ = load(html);
  const items = [];

  $("img.lazy, img[src]").each((_i, el) => {
    const name = $(el).attr("alt") || "";
    if (query && !name.includes(query)) return; // فلترة للبحث

    const dataSrc = $(el).attr("data-src") || $(el).attr("src") || "";
    if (!dataSrc.includes("/uploads/video_thumb/")) return;

    const href = $(el).closest("a").attr("href") || "";
    if (!href.includes("/watch/")) return;

    const slug = href.replace(/.*\/watch\//, "").replace(/\.html.*/, "");
    items.push({
      id: `alooyultra:${slug}`,
      type: catalogId.includes("movie") ? "movie" : "series",
      name: name,
      poster: dataSrc.startsWith("http") ? dataSrc : `${IMAGE_BASE}${dataSrc}`,
      posterShape: "poster"
    });
  });
  return items;
}

async function getSeriesMeta(slug) {
  const url = `${BASE_URL}/watch/${slug}.html`;
  const html = await fetchHtml(url);
  if (!html) return null;
  const $ = load(html);

  const episodes = [];
  $("a[href*='key=']").each((_i, el) => {
    const href = $(el).attr("href");
    const key = href.match(/[?&]key=([^&]+)/)?.[1];
    const text = $(el).text().trim();
    const epNum = text.match(/\d+/)?.[0] || (episodes.length + 1);

    if (key) {
      episodes.push({
        id: `alooyultra:${slug}:${key}`,
        title: `الحلقة ${epNum}`,
        season: 1,
        episode: parseInt(epNum),
        key: key
      });
    }
  });
  return { name: $("h1").text().trim() || "AlooYTV Content", episodes };
}

// ─── معالجات الطلبات (Handlers) ──────────────────────────────────────────────
const app = express();
app.use(cors());

app.get("/manifest.json", (_req, res) => res.json(MANIFEST));

// معالج الكتالوج والبحث (لحل مشكلة برنامج فورد)
app.get("/catalog/:type/:id.json", async (req, res) => {
  const query = req.query.search;
  try {
    const metas = await getCatalogItems(req.params.id, query);
    res.json({ metas });
  } catch { res.json({ metas: [] }); }
});

// معالج الـ Meta (لجلب قائمة الحلقات)
app.get("/meta/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  const slug = id.replace(/^(alooyultra:|tt)/, "").split(":")[0];
  try {
    const data = await getSeriesMeta(slug);
    const videos = data.episodes.map(ep => ({
      id: ep.id,
      title: ep.title,
      season: ep.season,
      episode: ep.episode,
      released: new Date().toISOString()
    }));
    res.json({
      meta: {
        id: id,
        type: req.params.type,
        name: data.name,
        poster: DEFAULT_THUMB,
        videos: req.params.type === "series" ? videos : undefined
      }
    });
  } catch { res.json({ meta: null }); }
});

// معالج الـ Stream (استخراج الرابط المباشر)
app.get("/stream/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  const cleanId = id.replace(/^(alooyultra:|tt)/, "");
  const [slug, key] = cleanId.split(":");

  const url = `${BASE_URL}/watch/${slug}.html${key ? `?key=${key}` : ""}`;
  try {
    const html = await fetchHtml(url);
    const streams = [];
    const srcMatch = html.match(/<source\s+src="(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/i);
    
    if (srcMatch) {
      streams.push({ title: "🎬 AlooYTV Ultra - مباشر", url: srcMatch[1] });
    }
    streams.push({ title: "🌐 فتح في الموقع", externalUrl: url });
    res.json({ streams });
  } catch { res.json({ streams: [] }); }
});

app.get("/", (_req, res) => res.send("<h1>AlooYTV Ultra is Active</h1>"));

app.listen(PORT);
export default app;
