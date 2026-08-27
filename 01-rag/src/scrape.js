import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import * as cheerio from 'cheerio';

const RAW_DIR = path.resolve('data/raw');

function parseArgs(argv) {
  const [startUrl, ...rest] = argv;
  if (!startUrl) {
    console.error('Usage: node src/scrape.js <startUrl> [--depth N] [--limit N]');
    process.exit(1);
  }
  const opts = { depth: 1, limit: 20 };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '');
    if (key in opts) opts[key] = Number(rest[i + 1]);
  }
  return { startUrl, ...opts };
}

function slugify(url) {
  return url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 120);
}

function extractText($) {
  $('script, style, nav, footer, header, noscript, svg, form').remove();
  const title = $('title').first().text().trim();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { title, text };
}

function extractLinks($, base) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    try {
      const url = new URL(href, base);
      url.hash = '';
      if (url.hostname === new URL(base).hostname && /^https?:$/.test(url.protocol)) {
        links.add(url.toString());
      }
    } catch {
      // ignore broken links (mailto:, javascript:, etc.)
    }
  });
  return [...links];
}

async function scrapePage(url) {
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'rag-node-demo-bot/1.0' },
  });
  const $ = cheerio.load(html);
  const { title, text } = extractText($);
  const links = extractLinks($, url);
  return { title, text, links };
}

async function crawl(startUrl, depth, limit) {
  const visited = new Set();
  const queue = [{ url: startUrl, level: 0 }];
  const pages = [];

  while (queue.length && pages.length < limit) {
    const { url, level } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      console.log(`Scraping (${pages.length + 1}/${limit}) [depth ${level}]: ${url}`);
      const { title, text, links } = await scrapePage(url);

      if (text.length > 200) {
        pages.push({ url, title, text, scrapedAt: new Date().toISOString() });
      }

      if (level < depth) {
        for (const link of links) {
          if (!visited.has(link)) queue.push({ url: link, level: level + 1 });
        }
      }
    } catch (err) {
      console.warn(`  skipped (${err.message})`);
    }
  }

  return pages;
}

async function main() {
  const { startUrl, depth, limit } = parseArgs(process.argv.slice(2));
  await fs.mkdir(RAW_DIR, { recursive: true });

  const pages = await crawl(startUrl, depth, limit);

  for (const page of pages) {
    const filePath = path.join(RAW_DIR, `${slugify(page.url)}.json`);
    await fs.writeFile(filePath, JSON.stringify(page, null, 2), 'utf-8');
  }

  console.log(`\nSaved ${pages.length} pages to ${RAW_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
