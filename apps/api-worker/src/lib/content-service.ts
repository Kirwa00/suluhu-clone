import type { ContentResourceInput } from '@suluhu/shared';
import type { Prisma, PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';

/** Psychoeducation content — port of apps/api's ContentService. */
export class ContentService {
  constructor(private readonly prisma: PrismaClient) {}

  async listPublished(filter: { category?: string; type?: string; language?: string }) {
    const where: Prisma.ContentResourceWhereInput = { published: true };
    if (filter.category) where.category = filter.category;
    if (filter.type) where.type = filter.type as Prisma.ContentResourceWhereInput['type'];
    if (filter.language)
      where.language = filter.language as Prisma.ContentResourceWhereInput['language'];

    const rows = await this.prisma.contentResource.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        category: true,
        type: true,
        language: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async getBySlug(slug: string) {
    const r = await this.prisma.contentResource.findFirst({ where: { slug, published: true } });
    if (!r) throw AppException.notFound('Resource not found');
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      body: r.body,
      category: r.category,
      type: r.type,
      language: r.language,
      createdAt: r.createdAt.toISOString(),
    };
  }

  // --- Admin ---
  async adminList() {
    const rows = await this.prisma.contentResource.findMany({ orderBy: { updatedAt: 'desc' } });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: r.category,
      type: r.type,
      language: r.language,
      published: r.published,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async create(authorId: string, input: ContentResourceInput) {
    const exists = await this.prisma.contentResource.findUnique({ where: { slug: input.slug } });
    if (exists) throw AppException.conflict('A resource with this slug already exists');
    const r = await this.prisma.contentResource.create({
      data: { ...input, language: input.language as 'en' | 'sw', authorId },
    });
    return { id: r.id, slug: r.slug };
  }

  async update(id: string, input: ContentResourceInput) {
    const exists = await this.prisma.contentResource.findUnique({ where: { id } });
    if (!exists) throw AppException.notFound('Resource not found');
    await this.prisma.contentResource.update({
      where: { id },
      data: { ...input, language: input.language as 'en' | 'sw' },
    });
    return { id };
  }
}
