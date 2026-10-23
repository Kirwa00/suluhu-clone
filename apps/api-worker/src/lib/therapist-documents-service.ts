import { UserRole, type AuthUser, type TherapistDocumentView } from '@suluhu/shared';
import type { CredentialDocumentType, PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { R2DocumentStorageService } from './document-storage';
import type { RequestContext } from './types';

export interface DownloadedDocument {
  bytes: ArrayBuffer;
  mimeType: string;
  filename: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/**
 * Document upload/list/download — port of apps/api's
 * TherapistDocumentsService, over R2 instead of local disk.
 */
export class TherapistDocumentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: R2DocumentStorageService,
    private readonly audit: AuditService,
  ) {}

  private async profileByUser(userId: string) {
    const profile = await this.prisma.therapistProfile.findUnique({ where: { userId } });
    if (!profile) throw AppException.notFound('Therapist profile not found');
    return profile;
  }

  async upload(
    userId: string,
    type: CredentialDocumentType,
    file: { originalname: string; bytes: ArrayBuffer; contentType?: string },
    ctx: RequestContext,
  ): Promise<TherapistDocumentView> {
    const profile = await this.profileByUser(userId);
    const { key } = await this.storage.save(
      profile.id,
      file.originalname,
      file.bytes,
      file.contentType,
    );

    const doc = await this.prisma.therapistDocument.create({
      data: {
        therapistId: profile.id,
        type,
        url: key,
        originalName: file.originalname,
      },
    });

    await this.audit.record({
      userId,
      action: 'therapist_document.upload',
      resourceType: 'therapist_document',
      resourceId: doc.id,
      ...ctx,
      metadata: { type },
    });

    return this.toView(doc);
  }

  async listMine(userId: string): Promise<TherapistDocumentView[]> {
    const profile = await this.profileByUser(userId);
    const docs = await this.prisma.therapistDocument.findMany({
      where: { therapistId: profile.id },
      orderBy: { uploadedAt: 'desc' },
    });
    return docs.map((d) => this.toView(d));
  }

  async download(
    documentId: string,
    requester: AuthUser,
    ctx: RequestContext,
  ): Promise<DownloadedDocument> {
    const doc = await this.prisma.therapistDocument.findUnique({
      where: { id: documentId },
      include: { therapist: { select: { userId: true } } },
    });
    if (!doc) throw AppException.notFound('Document not found');

    const isOwner = doc.therapist.userId === requester.id;
    const isAdmin = requester.role === UserRole.ADMIN || requester.role === UserRole.SUPER_ADMIN;
    if (!isOwner && !isAdmin) throw AppException.forbidden();

    const { bytes } = await this.storage.read(doc.url);

    await this.audit.record({
      userId: requester.id,
      action: 'therapist_document.download',
      resourceType: 'therapist_document',
      resourceId: doc.id,
      ...ctx,
    });

    return {
      bytes,
      mimeType: mimeFor(doc.originalName ?? doc.url),
      filename: doc.originalName ?? 'document',
    };
  }

  private toView(doc: {
    id: string;
    type: CredentialDocumentType;
    originalName: string | null;
    uploadedAt: Date;
  }): TherapistDocumentView {
    return {
      id: doc.id,
      type: doc.type,
      originalName: doc.originalName,
      uploadedAt: doc.uploadedAt.toISOString(),
    };
  }
}

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}
