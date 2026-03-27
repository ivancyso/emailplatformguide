import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.enum(['review', 'comparison', 'roundup', 'guide']),
    tags: z.array(z.string()).default([]),
    author: z.string().default('Editorial Team'),
    featuredImage: z.string().optional(),
    affiliateLinks: z.array(z.object({
      name: z.string(),
      url: z.string(),
      commission: z.string().optional(),
    })).default([]),
    rating: z.number().min(1).max(10).optional(),
    pros: z.array(z.string()).optional(),
    cons: z.array(z.string()).optional(),
  }),
});

export const collections = { articles };
