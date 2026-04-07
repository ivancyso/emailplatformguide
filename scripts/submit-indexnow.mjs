#!/usr/bin/env node

/**
 * Post-build script to submit all site URLs to Bing IndexNow API.
 *
 * Usage:
 *   BING_INDEXNOW_KEY=<key> node scripts/submit-indexnow.mjs
 *
 * The script reads the built sitemap from dist/sitemap-index.xml (or
 * dist/sitemap-0.xml) and submits every URL in batches of 10 000 (the
 * IndexNow limit per request).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

const SITE_URL = 'https://www.emailplatformguide.com';
const BING_INDEXNOW_KEY = process.env.BING_INDEXNOW_KEY || 'b39e80e2c7d24f8a9e1d5c3f7a2b6e4d';
const BATCH_SIZE = 10_000;

/** Extract <loc> values from an XML string. */
function extractLocs(xml) {
  const locs = [];
  const re = /<loc>\s*(.*?)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1]);
  }
  return locs;
}

/** Read sitemap files from the dist directory and collect all URLs. */
async function collectUrls() {
  const urls = new Set();

  // Try reading sitemap-index.xml first
  const indexPath = path.join(distDir, 'sitemap-index.xml');
  try {
    const indexXml = await fs.readFile(indexPath, 'utf8');
    const sitemapLocs = extractLocs(indexXml);

    for (const loc of sitemapLocs) {
      // Convert URL to local file path
      const fileName = loc.replace(SITE_URL, '').replace(/^\//, '');
      const filePath = path.join(distDir, fileName);
      try {
        const sitemapXml = await fs.readFile(filePath, 'utf8');
        for (const url of extractLocs(sitemapXml)) {
          urls.add(url);
        }
      } catch {
        console.warn(`Could not read sitemap file: ${filePath}`);
      }
    }
  } catch {
    // No sitemap-index.xml — try a single sitemap-0.xml
    const fallback = path.join(distDir, 'sitemap-0.xml');
    try {
      const xml = await fs.readFile(fallback, 'utf8');
      for (const url of extractLocs(xml)) {
        urls.add(url);
      }
    } catch {
      console.error('No sitemap files found in dist/. Run `npm run build` first.');
      process.exit(1);
    }
  }

  return [...urls];
}

/** Submit a batch of URLs to Bing IndexNow. */
async function submitBatch(urls) {
  const body = {
    host: new URL(SITE_URL).host,
    key: BING_INDEXNOW_KEY,
    keyLocation: `${SITE_URL}/${BING_INDEXNOW_KEY}.txt`,
    urlList: urls,
  };

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IndexNow API ${res.status}: ${text}`);
  }
}

async function main() {
  const urls = await collectUrls();
  if (urls.length === 0) {
    console.log('No URLs found to submit.');
    return;
  }

  console.log(`Found ${urls.length} URLs to submit to IndexNow.`);

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(urls.length / BATCH_SIZE);

    try {
      await submitBatch(batch);
      console.log(`Batch ${batchNum}/${totalBatches}: submitted ${batch.length} URLs`);
    } catch (err) {
      console.error(`Batch ${batchNum}/${totalBatches} failed: ${err.message}`);
    }
  }

  console.log('IndexNow submission complete.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
