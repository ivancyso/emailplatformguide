# Email Platform Guide

Astro site with Markdown content under `src/content/articles`, plus a local bulk generator for creating many SEO blog posts from keyword CSV inputs.

## Commands

- `npm install` - install dependencies
- `npm run dev` - start local Astro dev server
- `npm run build` - production build
- `npm run preview` - preview production build
- `npm run generate:posts` - generate posts locally using OpenRouter

## Bulk blog generation

1. Copy `.env.example` to `.env` and fill values.
2. Put your keywords in `25.csv` (one per line or comma-separated).
3. Run:

```bash
npm run generate:posts
```

Default generation behavior:
- target total posts: `2500`
- rate limit: `50` posts/minute
- concurrency: `10`
- model: `nx-ai/grok-4.1-fast`

### Bing IndexNow support

If `BING_INDEXNOW_KEY` is set, generation will:
- create `public/<key>.txt`
- submit each generated post URL to Bing IndexNow
