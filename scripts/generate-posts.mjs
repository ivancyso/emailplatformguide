import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const articlesDir = path.join(projectRoot, 'src/content/articles');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'x-ai/grok-4.1-fast';
const KEYWORDS_CSV_PATH = path.resolve(projectRoot, process.env.KEYWORDS_CSV_PATH ?? '25.csv');
const TARGET_TOTAL_POSTS = Number(process.env.TARGET_TOTAL_POSTS ?? 2500);
const POSTS_PER_MINUTE = Number(process.env.POSTS_PER_MINUTE ?? 50);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY ?? 10);
const SITE_URL = (process.env.SITE_URL ?? 'https://www.emailplatformguide.com').replace(/\/$/, '');
const BING_INDEXNOW_KEY = process.env.BING_INDEXNOW_KEY ?? '';

const MIN_REQUEST_INTERVAL_MS = Math.ceil(60000 / Math.max(POSTS_PER_MINUTE, 1));
const CATEGORIES = ['review', 'comparison', 'roundup', 'guide'];

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function csvKeywords(csvRaw) {
  const lines = csvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];
  return lines
    .flatMap((line) => line.split(','))
    .map((v) => v.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function frontmatter(post) {
  const today = new Date().toISOString();
  const category = CATEGORIES.includes(post.category) ? post.category : 'guide';
  const tags = Array.isArray(post.tags) ? post.tags.slice(0, 8) : [];
  const safeTitle = String(post.title ?? '').trim() || 'Untitled';
  const safeDescription = String(post.description ?? '').trim().slice(0, 240) || safeTitle;
  const safeBody = String(post.body ?? '').trim();

  return `---
title: "${safeTitle.replaceAll('"', '\\"')}"
description: "${safeDescription.replaceAll('"', '\\"')}"
pubDate: ${today}
category: ${category}
tags: [${tags.map((tag) => `"${String(tag).replaceAll('"', '\\"')}"`).join(', ')}]
author: "Editorial Team"
---

${safeBody}
`;
}

class RateLimiter {
  constructor(intervalMs) {
    this.intervalMs = intervalMs;
    this.nextAllowedAt = 0;
  }

  async waitTurn() {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAllowedAt - now);
    this.nextAllowedAt = Math.max(this.nextAllowedAt, now) + this.intervalMs;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function generatePost(keyword, sequence) {
  const prompt = `You are writing SEO-focused blog posts about email marketing tools.
Return ONLY valid JSON with this exact shape:
{
  "title": "string",
  "description": "string (<= 160 chars)",
  "category": "review|comparison|roundup|guide",
  "tags": ["string", "string"],
  "body": "markdown body at least 900 words, with h2/h3 sections, practical advice, no fake claims, and conclusion"
}

Keyword focus: ${keyword}
Sequence number: ${sequence}
Audience: people choosing email marketing platforms.
`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL,
      'X-Title': 'EmailPlatformGuide Bulk Post Generator'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.5,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned empty content.');
  }

  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1));
    }
    throw new Error('Failed to parse model JSON response.');
  }
}

async function ensureIndexNowKeyFile() {
  if (!BING_INDEXNOW_KEY) return '';
  const keyFilePath = path.join(projectRoot, 'public', `${BING_INDEXNOW_KEY}.txt`);
  await fs.writeFile(keyFilePath, `${BING_INDEXNOW_KEY}\n`, 'utf8');
  return `${SITE_URL}/${BING_INDEXNOW_KEY}.txt`;
}

async function submitIndexNow(urls, keyLocation) {
  if (!BING_INDEXNOW_KEY || urls.length === 0) return;
  const response = await fetch('https://www.bing.com/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(SITE_URL).host,
      key: BING_INDEXNOW_KEY,
      keyLocation,
      urlList: urls
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`IndexNow error ${response.status}: ${body}`);
  }
}

async function getExistingPostCount() {
  const files = await fs.readdir(articlesDir);
  return files.filter((file) => file.endsWith('.md')).length;
}

async function writePostFile(postData, keyword, sequence) {
  const baseSlug = slugify(postData.title || keyword) || `post-${sequence}`;
  const uniqueSuffix = crypto.randomBytes(3).toString('hex');
  const fileName = `${baseSlug}-${uniqueSuffix}.md`;
  const fullPath = path.join(articlesDir, fileName);
  await fs.writeFile(fullPath, frontmatter(postData), 'utf8');
  return {
    fileName,
    url: `${SITE_URL}/${fileName.replace(/\.md$/, '/')}`
  };
}

async function main() {
  if (!OPENROUTER_API_KEY) {
    throw new Error('Missing OPENROUTER_API_KEY environment variable.');
  }

  const csvRaw = await fs.readFile(KEYWORDS_CSV_PATH, 'utf8');
  const keywords = csvKeywords(csvRaw);
  if (keywords.length === 0) {
    throw new Error(`No keywords found in ${KEYWORDS_CSV_PATH}.`);
  }

  await fs.mkdir(articlesDir, { recursive: true });
  const currentPosts = await getExistingPostCount();
  const remaining = Math.max(0, TARGET_TOTAL_POSTS - currentPosts);

  console.log(`Current posts: ${currentPosts}`);
  console.log(`Target posts: ${TARGET_TOTAL_POSTS}`);
  console.log(`Posts to generate: ${remaining}`);
  console.log(`Rate limit: ${POSTS_PER_MINUTE}/min, concurrency: ${MAX_CONCURRENCY}`);

  if (remaining === 0) {
    console.log('Target already reached. Nothing to generate.');
    return;
  }

  const keyLocation = await ensureIndexNowKeyFile();
  const limiter = new RateLimiter(MIN_REQUEST_INTERVAL_MS);
  let nextSequence = currentPosts + 1;
  let completed = 0;
  let failures = 0;

  const tasks = Array.from({ length: remaining }, (_, idx) => idx);
  let cursor = 0;

  async function worker(workerId) {
    while (cursor < tasks.length) {
      const taskIndex = cursor;
      cursor += 1;

      const keyword = keywords[taskIndex % keywords.length];
      const sequence = nextSequence;
      nextSequence += 1;

      try {
        await limiter.waitTurn();
        const generated = await generatePost(keyword, sequence);
        const result = await writePostFile(generated, keyword, sequence);
        completed += 1;
        process.stdout.write(
          `[worker-${workerId}] ${completed}/${remaining} generated: ${result.fileName}\n`
        );

        if (BING_INDEXNOW_KEY) {
          await submitIndexNow([result.url], keyLocation);
        }
      } catch (error) {
        failures += 1;
        process.stderr.write(
          `[worker-${workerId}] failed on "${keyword}" (#${sequence}): ${error.message}\n`
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, remaining) },
    (_, idx) => worker(idx + 1)
  );
  await Promise.all(workers);
  console.log(`Done. Generated: ${completed}, failures: ${failures}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
