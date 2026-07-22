
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../config/db.js';
import { t } from '../../shared/services/translate/translate.service.js';
import { Logger } from '../../config/logger.js';
import { config } from '../../config/config.js';
import { notificationService } from '../notification/notification.service.js';
import {
    activateArchiveSubscription,
    computeFreeDownloadUntil,
    formatCertificateAccess,
    getActiveArchiveSubscription,
    getArchivePlan,
    userHasArchiveAccess,
} from './certificate.archive.js';
import { platformSettingService } from '../platformSetting/platformSetting.service.js';
import {
    generateCertificatePdf,
    deleteCertificatePdf,
} from './certificate-pdf.generator.js';

const log = new Logger('CertificateService');

const PDF_DIR = path.join(process.cwd(), 'uploads', 'certificates', 'pdfs');

const ENROLLMENT_INCLUDE = {
    user: {
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            tenantId: true,
            preferredLanguage: true,
            companyId: true,
            company: { select: { id: true, name: true, logoUrl: true } },
        },
    },
    course: {
        select: {
            id: true,
            courseTitle: true,
            tenantId: true,
            createdById: true,
            passScorePercent: true,
            certificateTemplateUrl: true,
            certificateTemplateConfig: true,
            tenant: { select: { id: true, name: true, logoUrl: true } },
        },
    },
    companyContext: { select: { id: true, name: true, logoUrl: true } },
};

export class CertificateService {

    _buildUserNameSearchConditions(term) {
        if (!term?.trim()) return [];
        const search = term.trim();
        const conditions = [
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { firstName: { contains: search, mode: 'insensitive' } } },
            { user: { lastName: { contains: search, mode: 'insensitive' } } },
        ];

        const parts = search.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            conditions.push({
                user: {
                    AND: [
                        { firstName: { contains: parts[0], mode: 'insensitive' } },
                        { lastName: { contains: parts.slice(1).join(' '), mode: 'insensitive' } },
                    ],
                },
            });
        }

        return conditions;
    }

    _buildCourseTitleSearchConditions(term) {
        if (!term?.trim()) return [];
        const search = term.trim();
        return [
            { course: { courseTitle: { path: ['it'], string_contains: search } } },
            { course: { courseTitle: { path: ['en'], string_contains: search } } },
            { course: { courseTitle: { path: ['fr'], string_contains: search } } },
            { course: { courseTitle: { path: ['zh'], string_contains: search } } },
            { course: { slug: { contains: search, mode: 'insensitive' } } },
        ];
    }

    _applyCertificateSearchFilters(where, queryParams = {}) {
        const searchGroups = [];

        if (queryParams.search?.trim()) {
            searchGroups.push({
                OR: [
                    ...this._buildUserNameSearchConditions(queryParams.search),
                    ...this._buildCourseTitleSearchConditions(queryParams.search),
                ],
            });
        } else {
            if (queryParams.employeeName?.trim()) {
                searchGroups.push({ OR: this._buildUserNameSearchConditions(queryParams.employeeName) });
            }
            if (queryParams.courseName?.trim()) {
                searchGroups.push({ OR: this._buildCourseTitleSearchConditions(queryParams.courseName) });
            }
        }

        if (searchGroups.length === 1) {
            where.AND = [...(where.AND ?? []), searchGroups[0]];
        } else if (searchGroups.length > 1) {
            where.AND = [...(where.AND ?? []), ...searchGroups];
        }

        return where;
    }

    async autoGenerateOnCompletion(enrollmentId) {
        try {
            const enrollment = await prisma.enrollment.findUnique({
                where: { id: enrollmentId },
                include: ENROLLMENT_INCLUDE,
            });

            if (!enrollment) {
                log.warn(`autoGenerateOnCompletion: Enrollment ${enrollmentId} not found`);
                return null;
            }

            if (enrollment.status !== 'COMPLETED') {
                log.warn(`autoGenerateOnCompletion: Enrollment ${enrollmentId} is not COMPLETED (status: ${enrollment.status})`);
                return null;
            }

            const existing = await prisma.certificate.findUnique({
                where: { enrollmentId },
                select: { id: true, status: true, pdfUrl: true },
            });

            if (existing?.status === 'ISSUED' && this._pdfFileExists(existing.id)) {
                log.info(`Certificate already ISSUED for enrollment ${enrollmentId}`);
                return existing;
            }

            return this._issueCertificate({
                enrollment,
                existingCertificateId: existing?.id || null,
                companyLogoUrl: null,
                issueDate: new Date(),
                expiryDate: await computeFreeDownloadUntil(new Date()),
            });
        } catch (error) {
            log.error(`autoGenerateOnCompletion failed for enrollment ${enrollmentId}: ${error.message}`);
            return null;
        }
    }

    async getAllCertificates(queryParams = {}, locale = 'it', user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = {};

        if (user?.level === 'LICENSE_USER') {
            where.course = { createdById: user.id };
        } else if (user?.level === 'COMPANY_ADMIN') {
            if (!user.companyId) throw new Error('Company Admin has no company assigned');
            where.user = { companyId: user.companyId };
        } else if (user?.level === 'PLATFORM_ADMIN') {
            if (queryParams.courseId) where.courseId = queryParams.courseId;
            // Livello 4 — platform master sees all certificates (optional tenant filter)
            if (queryParams.tenantId) where.tenantId = queryParams.tenantId;
        }

        if (queryParams.userId) where.userId = queryParams.userId;
        if (queryParams.courseId && user?.level !== 'PLATFORM_ADMIN') where.courseId = queryParams.courseId;
        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.archived !== undefined) where.archived = queryParams.archived === 'true';
        if (queryParams.year) {
            const year = parseInt(queryParams.year, 10);
            where.issuedAt = {
                gte: new Date(`${year}-01-01`),
                lt: new Date(`${year + 1}-01-01`),
            };
        }

        this._applyCertificateSearchFilters(where, queryParams);

        const orderBy = {
            [queryParams.sortBy || 'issuedAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [certificates, total] = await Promise.all([
            prisma.certificate.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    user: {
                        select: { id: true, email: true, firstName: true, lastName: true, level: true },
                    },
                    course: {
                        select: { id: true, courseTitle: true, slug: true },
                    },
                    enrollment: {
                        select: { id: true, status: true, startedAt: true, completedAt: true },
                    },
                    tenant: {
                        select: { id: true, name: true },
                    },
                },
            }),
            prisma.certificate.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            appliedFilters: {
                search: queryParams.search ?? null,
                employeeName: queryParams.employeeName ?? null,
                courseName: queryParams.courseName ?? null,
                userId: queryParams.userId ?? null,
                courseId: queryParams.courseId ?? null,
                status: queryParams.status ?? null,
                year: queryParams.year ?? null,
            },
            certificates: certificates.map(cert => this._formatCertificate(cert, locale)),
        };
    }

    async getMyCertificates(userId, queryParams = {}, locale = 'it') {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = { userId, status: 'ISSUED' };
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.year) {
            const year = parseInt(queryParams.year, 10);
            where.issuedAt = {
                gte: new Date(`${year}-01-01`),
                lt: new Date(`${year + 1}-01-01`),
            };
        }

        if (queryParams.search?.trim() || queryParams.courseName?.trim()) {
            const courseTerm = queryParams.courseName?.trim() || queryParams.search?.trim();
            where.AND = [
                ...(where.AND ?? []),
                { OR: this._buildCourseTitleSearchConditions(courseTerm) },
            ];
        }

        const orderBy = {
            [queryParams.sortBy || 'issuedAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const archiveSubscription = await getActiveArchiveSubscription(userId);
        const hasArchiveAccess = Boolean(archiveSubscription);
        const archivePlan = await getArchivePlan(locale);

        const [certificates, total] = await Promise.all([
            prisma.certificate.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    course: {
                        select: { id: true, courseTitle: true, slug: true, thumbnailUrl: true },
                    },
                    enrollment: {
                        select: { completedAt: true, status: true },
                    },
                },
            }),
            prisma.certificate.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            archive: {
                hasActiveSubscription: hasArchiveAccess,
                expiresAt: archiveSubscription?.expiresAt ?? null,
                plan: archivePlan,
                freeDownloadDays: archivePlan.freeDownloadDays,
            },
            appliedFilters: {
                search: queryParams.search ?? null,
                courseName: queryParams.courseName ?? null,
                courseId: queryParams.courseId ?? null,
                year: queryParams.year ?? null,
            },
            certificates: certificates.map(cert => {
                const access = formatCertificateAccess(cert, hasArchiveAccess);
                return {
                    id: cert.id,
                    pdfUrl: access.canDownload ? cert.pdfUrl : null,
                    qrCode: cert.qrCode,
                    companyLogoUrl: cert.companyLogoUrl,
                    status: cert.status,
                    issuedAt: cert.issuedAt,
                    downloadableUntil: cert.downloadableUntil,
                    downloadCount: cert.downloadCount,
                    lastDownloadedAt: cert.lastDownloadedAt,
                    archived: cert.archived,
                    ...access,
                    course: {
                        id: cert.course.id,
                        title: this._resolveTitle(cert.course.courseTitle, locale),
                        courseTitle: this._resolveTitle(cert.course.courseTitle, locale),
                        slug: cert.course.slug,
                        thumbnailUrl: cert.course.thumbnailUrl,
                    },
                    enrollmentStatus: cert.enrollment?.status ?? null,
                    completedAt: cert.enrollment?.completedAt ?? null,
                };
            }),
        };
    }

    async getArchiveStatus(userId, locale = 'it') {
        const subscription = await getActiveArchiveSubscription(userId);
        const certCount = await prisma.certificate.count({
            where: { userId, status: 'ISSUED' },
        });
        const plan = await getArchivePlan(locale);
        return {
            plan,
            subscription: subscription
                ? {
                    id: subscription.id,
                    isActive: subscription.isActive,
                    startedAt: subscription.startedAt,
                    expiresAt: subscription.expiresAt,
                    storageMb: subscription.storageMb,
                }
                : null,
            certificateCount: certCount,
            hasArchiveAccess: Boolean(subscription),
        };
    }

    async getCertificateById(id, locale = 'it', user = null) {
        const certificate = await prisma.certificate.findUnique({
            where: { id },
            include: {
                user: {
                    select: { id: true, email: true, firstName: true, lastName: true, level: true },
                },
                course: {
                    select: { id: true, courseTitle: true, slug: true, description: true },
                },
                enrollment: {
                    select: { id: true, status: true, startedAt: true, completedAt: true },
                },
                tenant: {
                    select: { id: true, name: true },
                },
            },
        });

        if (!certificate) return null;

        await this._checkViewPermission(certificate, user);

        return {
            id: certificate.id,
            pdfUrl: certificate.pdfUrl,
            qrCode: certificate.qrCode,
            timestampProof: certificate.timestampProof,
            companyLogoUrl: certificate.companyLogoUrl,
            status: certificate.status,
            issuedAt: certificate.issuedAt,
            downloadableUntil: certificate.downloadableUntil,
            editUnlockedOnce: certificate.editUnlockedOnce,
            archived: certificate.archived,
            archivedAt: certificate.archivedAt,
            downloadCount: certificate.downloadCount,
            lastDownloadedAt: certificate.lastDownloadedAt,
            isExpired: certificate.downloadableUntil ? new Date() > certificate.downloadableUntil : false,
            user: {
                id: certificate.user.id,
                name: `${certificate.user.firstName || ''} ${certificate.user.lastName || ''}`.trim(),
                firstName: certificate.user.firstName,
                lastName: certificate.user.lastName,
                email: certificate.user.email,
            },
            course: {
                id: certificate.course.id,
                title: this._resolveTitle(certificate.course.courseTitle, locale),
                courseTitle: this._resolveTitle(certificate.course.courseTitle, locale),
                slug: certificate.course.slug,
                description: t(certificate.course.description, locale) || null,
            },
            enrollment: certificate.enrollment
                ? {
                    status: certificate.enrollment.status,
                    startedAt: certificate.enrollment.startedAt,
                    completedAt: certificate.enrollment.completedAt,
                }
                : null,
            tenant: certificate.tenant
                ? { id: certificate.tenant.id, name: certificate.tenant.name }
                : null,
            createdAt: certificate.createdAt,
        };
    }

    async generateCertificate(data, userId) {
        const { enrollmentId, companyLogoUrl, issueDate, expiryDate, forceComplete, forceRegenerate } = data;

        let enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            include: ENROLLMENT_INCLUDE,
        });

        if (!enrollment) throw new Error('Enrollment not found');

        const requestingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { level: true, tenantId: true, companyId: true },
        });
        if (!requestingUser) throw new Error('User not found');

        await this._checkGeneratePermission(enrollment, userId, requestingUser);

        const isAdmin = ['PLATFORM_ADMIN', 'LICENSE_USER'].includes(requestingUser.level);
        const isCompanyAdmin = requestingUser.level === 'COMPANY_ADMIN';
        const canForce = (isAdmin || isCompanyAdmin) && forceComplete === true;

        if (enrollment.status !== 'COMPLETED') {
            if (!canForce) {
                throw new Error(
                    'Course must be completed before generating a certificate. ' +
                    'If you want to force-generate, pass forceComplete: true in the request body.'
                );
            }

            enrollment = await prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'COMPLETED', completedAt: new Date() },
                include: ENROLLMENT_INCLUDE,
            });
            log.info(`Enrollment ${enrollmentId} force-completed by user ${userId}`);
        }

        const existing = await prisma.certificate.findUnique({
            where: { enrollmentId },
            select: { id: true, status: true },
        });

        if (existing?.status === 'ISSUED') {
            const pdfExists = this._pdfFileExists(existing.id);
            if (!forceRegenerate && pdfExists) {
                throw new Error('Certificate already issued for this enrollment. Pass forceRegenerate: true to regenerate the PDF.');
            }
        }

        const now = new Date();
        const certificate = await this._issueCertificate({
            enrollment,
            existingCertificateId: existing?.id || null,
            companyLogoUrl: companyLogoUrl || null,
            issueDate: issueDate ? new Date(issueDate) : now,
            expiryDate: expiryDate
                ? new Date(expiryDate)
                : await computeFreeDownloadUntil(issueDate ? new Date(issueDate) : now),
            includeRelations: true,
        });

        log.info(`Certificate generated: ${certificate.id} by user ${userId}`);
        return certificate;
    }

    async updateCertificate(id, data, userId) {
        const existing = await prisma.certificate.findUnique({
            where: { id },
            select: { id: true, userId: true, editUnlockedOnce: true },
        });
        if (!existing) throw new Error('Certificate not found');

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { level: true },
        });
        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Permission denied: Only Platform Admin can update certificates');
        }

        const updateData = {};
        if (data.status !== undefined) updateData.status = data.status;
        if (data.companyLogoUrl !== undefined) updateData.companyLogoUrl = data.companyLogoUrl;
        if (data.downloadableUntil !== undefined) updateData.downloadableUntil = new Date(data.downloadableUntil);

        if (data.editUnlockedOnce === true && !existing.editUnlockedOnce) {
            updateData.editUnlockedOnce = true;
        }

        if (data.status === 'REVOKED') {
            updateData.archived = true;
            updateData.archivedAt = new Date();
        }

        return prisma.certificate.update({
            where: { id },
            data: updateData,
            include: {
                user: { select: { id: true, email: true, firstName: true, lastName: true } },
                course: { select: { id: true, courseTitle: true, slug: true } },
                enrollment: { select: { status: true, completedAt: true } },
            },
        });
    }

    async downloadCertificate(id, requestingUser) {
        const userId = requestingUser.id;

        let certificate = await prisma.certificate.findUnique({
            where: { id },
            select: {
                id: true,
                userId: true,
                courseId: true,
                enrollmentId: true,
                pdfUrl: true,
                downloadCount: true,
                status: true,
                downloadableUntil: true,
                issuedAt: true,
                archived: true,
            },
        });

        if (!certificate) throw new Error('Certificate not found');

        await platformSettingService.assertDownloadAllowed();
        await this._checkDownloadPermission(certificate, requestingUser);

        if (certificate.status !== 'ISSUED') {
            throw new Error(`Certificate is ${certificate.status.toLowerCase()} and cannot be downloaded`);
        }

        const isCompanyAdminForEmployee =
            requestingUser.level === 'COMPANY_ADMIN'
            && certificate.userId !== requestingUser.id;

        const hasArchive = await userHasArchiveAccess(certificate.userId);
        let access = formatCertificateAccess(certificate, hasArchive);

        if (isCompanyAdminForEmployee) {
            access = {
                ...access,
                downloadStatus: 'AVAILABLE',
                canDownload: true,
                isExpired: false,
                needsArchivePurchase: false,
                freeDownloadMessage: 'Company admin download',
            };
        } else if (!access.canDownload) {
            const archiveConfig = await platformSettingService.getCertificateArchivePlan();
            throw new Error(
                `Certificate free download period (${archiveConfig.freeDownloadDays} days) has expired. ` +
                'Purchase archive storage at GET /api/v1/certificates/archive/plan to download again.'
            );
        }

        if (!this._pdfFileExists(certificate.id)) {
            log.warn(`PDF missing for certificate ${id}, regenerating...`);
            const enrollment = await prisma.enrollment.findUnique({
                where: { id: certificate.enrollmentId },
                include: ENROLLMENT_INCLUDE,
            });
            if (!enrollment) throw new Error('Enrollment not found for certificate regeneration');

            const regenerated = await this._issueCertificate({
                enrollment,
                existingCertificateId: certificate.id,
                companyLogoUrl: null,
                issueDate: certificate.issuedAt || new Date(),
                expiryDate: certificate.downloadableUntil || await computeFreeDownloadUntil(),
            });
            certificate = { ...certificate, pdfUrl: regenerated.pdfUrl };
        }

        await prisma.certificate.update({
            where: { id },
            data: {
                downloadCount: { increment: 1 },
                lastDownloadedAt: new Date(),
            },
        });

        return {
            pdfUrl: certificate.pdfUrl,
            downloadCount: certificate.downloadCount + 1,
            ...access,
        };
    }

    async verifyCertificate(certificateId) {
        const certificate = await prisma.certificate.findUnique({
            where: { id: certificateId },
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                course: {
                    select: { id: true, courseTitle: true, slug: true },
                },
                enrollment: {
                    select: { completedAt: true },
                },
                tenant: {
                    select: { id: true, name: true },
                },
            },
        });

        if (!certificate) return { valid: false, message: 'Certificate not found' };
        if (certificate.status !== 'ISSUED') {
            return { valid: false, message: `Certificate is ${certificate.status.toLowerCase()}` };
        }

        const ownerHasArchive = await userHasArchiveAccess(certificate.userId);
        const access = formatCertificateAccess(certificate, ownerHasArchive);

        return {
            valid: true,
            message: 'Certificate is valid',
            data: {
                certificateId: certificate.id,
                user: {
                    name: `${certificate.user.firstName || ''} ${certificate.user.lastName || ''}`.trim(),
                    email: certificate.user.email,
                },
                course: certificate.course.courseTitle,
                organization: certificate.tenant?.name || null,
                issuedAt: certificate.issuedAt,
                completedAt: certificate.enrollment?.completedAt ?? null,
                timestampProof: certificate.timestampProof,
                downloadableUntil: certificate.downloadableUntil,
                downloadAvailable: access.canDownload,
                archived: certificate.archived,
                qrCode: certificate.qrCode,
            },
        };
    }

    async deleteCertificate(id, userId) {
        const existing = await prisma.certificate.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new Error('Certificate not found');

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { level: true },
        });
        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Permission denied: Only Platform Admin can delete certificates');
        }

        await deleteCertificatePdf(id);

        return prisma.certificate.delete({
            where: { id },
            select: { id: true, userId: true, courseId: true },
        });
    }

    async _issueCertificate({
        enrollment,
        existingCertificateId = null,
        companyLogoUrl = null,
        issueDate,
        expiryDate,
        includeRelations = false,
    }) {
        const certificateId = existingCertificateId || randomUUID();
        const locale = enrollment.user.preferredLanguage || 'it';

        if (existingCertificateId) {
            await deleteCertificatePdf(existingCertificateId);
        }

        const studentName = this._resolveStudentName(enrollment.user);
        const courseTitle = this._resolveTitle(enrollment.course.courseTitle, locale);
        const organizationName = this._resolveOrganizationName(enrollment);
        const logoUrl = companyLogoUrl
            || enrollment.companyContext?.logoUrl
            || enrollment.user.company?.logoUrl
            || enrollment.course.tenant?.logoUrl
            || null;

        const qrCode = this._generateQrCode(certificateId);
        const verifyUrl = `${config.CLIENT_URL || 'http://localhost:5173'}/verify/${certificateId}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verifyUrl)}`;

        const { pdfUrl } = await generateCertificatePdf({
            certificateId,
            studentName,
            courseTitle,
            organizationName,
            issueDate,
            completedAt: enrollment.completedAt,
            certificateTemplateUrl: enrollment.course.certificateTemplateUrl,
            certificateTemplateConfig: enrollment.course.certificateTemplateConfig,
            companyLogoUrl: logoUrl,
            qrCodeUrl,
        });

        const timestampProof = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
        const tenantId = enrollment.user.tenantId || enrollment.course.tenantId || null;

        const certificateData = {
            enrollmentId: enrollment.id,
            userId: enrollment.user.id,
            courseId: enrollment.course.id,
            pdfUrl,
            qrCode,
            timestampProof,
            companyLogoUrl: logoUrl,
            status: 'ISSUED',
            issuedAt: issueDate,
            downloadableUntil: expiryDate,
            tenantId,
        };

        const include = includeRelations
            ? {
                user: { select: { id: true, email: true, firstName: true, lastName: true } },
                course: { select: { id: true, courseTitle: true, slug: true } },
                enrollment: { select: { status: true, completedAt: true } },
            }
            : undefined;

        let certificate;
        if (existingCertificateId) {
            certificate = await prisma.certificate.update({
                where: { id: existingCertificateId },
                data: certificateData,
                include,
            });
        } else {
            certificate = await prisma.certificate.create({
                data: { id: certificateId, ...certificateData },
                include,
            });
        }

        try {
            await notificationService.notifyCertificateReady({
                userId: enrollment.user.id,
                courseTitle,
                tenantId,
                pdfUrl: certificate.pdfUrl,
                certificateId: certificate.id,
                downloadableUntil: certificate.downloadableUntil,
            });
        } catch (err) {
            log.error(`Could not send certificate notification: ${err.message}`);
        }

        return certificate;
    }

    _pdfFileExists(certificateId) {
        return fs.existsSync(path.join(PDF_DIR, `${certificateId}.pdf`));
    }

    _formatCertificate(cert, locale) {
        return {
            id: cert.id,
            pdfUrl: cert.pdfUrl,
            qrCode: cert.qrCode,
            timestampProof: cert.timestampProof,
            companyLogoUrl: cert.companyLogoUrl,
            status: cert.status,
            issuedAt: cert.issuedAt,
            downloadableUntil: cert.downloadableUntil,
            archived: cert.archived,
            archivedAt: cert.archivedAt,
            downloadCount: cert.downloadCount,
            lastDownloadedAt: cert.lastDownloadedAt,
            isExpired: cert.downloadableUntil ? new Date() > cert.downloadableUntil : false,
            user: {
                id: cert.user.id,
                name: `${cert.user.firstName || ''} ${cert.user.lastName || ''}`.trim(),
                firstName: cert.user.firstName,
                lastName: cert.user.lastName,
                email: cert.user.email,
                level: cert.user.level,
            },
            course: {
                id: cert.course.id,
                title: this._resolveTitle(cert.course.courseTitle, locale),
                courseTitle: this._resolveTitle(cert.course.courseTitle, locale),
                slug: cert.course.slug,
            },
            enrollment: cert.enrollment
                ? {
                    status: cert.enrollment.status,
                    startedAt: cert.enrollment.startedAt,
                    completedAt: cert.enrollment.completedAt,
                }
                : null,
            tenant: cert.tenant ? { id: cert.tenant.id, name: cert.tenant.name } : null,
        };
    }

    async _checkDownloadPermission(certificate, user) {
        if (!user?.id) throw new Error('Authentication required');
        if (certificate.userId === user.id) return;

        if (user.level === 'COMPANY_ADMIN') {
            const employee = await prisma.user.findUnique({
                where: { id: certificate.userId },
                select: { companyId: true },
            });
            if (employee?.companyId && employee.companyId === user.companyId) return;
            throw new Error('Permission denied: This employee is not in your company');
        }

        if (user.level === 'PLATFORM_ADMIN') return;

        if (user.level === 'LICENSE_USER') {
            const course = await prisma.course.findUnique({
                where: { id: certificate.courseId },
                select: { createdById: true },
            });
            if (course?.createdById === user.id) return;
        }

        throw new Error('Permission denied: You cannot download this certificate');
    }

    async _checkViewPermission(certificate, user) {
        if (!user) throw new Error('Authentication required');
        if (certificate.userId === user.id) return;

        if (user.level === 'PLATFORM_ADMIN') return;

        if (user.level === 'COMPANY_ADMIN') {
            const employee = await prisma.user.findUnique({
                where: { id: certificate.userId },
                select: { companyId: true },
            });
            if (employee?.companyId && employee.companyId === user.companyId) return;
            throw new Error('Permission denied: You cannot view this certificate');
        }

        if (user.level === 'LICENSE_USER') {
            const course = await prisma.course.findUnique({
                where: { id: certificate.courseId },
                select: { createdById: true },
            });
            if (course?.createdById === user.id) return;
            throw new Error('Permission denied: You cannot view this certificate');
        }

        if (user.level === 'TEACHER' || user.level === 'TUTOR') {
            const teacherCourse = await prisma.course.findFirst({
                where: {
                    id: certificate.courseId,
                    OR: [
                        { teacherId: user.id },
                        { tutorId: user.id },
                        { createdById: user.id },
                    ],
                },
                select: { id: true },
            });
            if (teacherCourse) return;
        }

        throw new Error('Permission denied: You cannot view this certificate');
    }

    async _checkGeneratePermission(enrollment, userId, requestingUser = null) {
        if (!requestingUser) {
            requestingUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { level: true, tenantId: true, companyId: true },
            });
        }
        if (!requestingUser) throw new Error('User not found');

        if (requestingUser.level === 'PLATFORM_ADMIN') {
            return;
        }

        if (requestingUser.level === 'LICENSE_USER') {
            if (enrollment.course?.createdById !== requestingUser.id) {
                throw new Error('Permission denied: only the course creator can generate certificates');
            }
            return;
        }

        if (requestingUser.level === 'COMPANY_ADMIN') {
            if (!requestingUser.companyId) throw new Error('Company Admin has no company assigned');

            const enrolledUserCompany = await prisma.user.findUnique({
                where: { id: enrollment.userId },
                select: { companyId: true },
            });
            if (enrolledUserCompany?.companyId === requestingUser.companyId) return;
            throw new Error('Permission denied: This employee is not in your company');
        }

        if (['TEACHER', 'TUTOR'].includes(requestingUser.level)) {
            const teacherCourse = await prisma.course.findFirst({
                where: {
                    id: enrollment.courseId,
                    OR: [
                        { teacherId: userId },
                        { tutorId: userId },
                        { createdById: userId },
                    ],
                },
                select: { id: true },
            });
            if (teacherCourse) return;
            throw new Error('Permission denied: You are not the teacher/tutor of this course');
        }

        throw new Error('Permission denied: Insufficient privileges to generate certificates');
    }

    _generateQrCode(certificateId) {
        const verifyUrl = `${config.CLIENT_URL || 'http://localhost:5173'}/verify/${certificateId}`;
        return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verifyUrl)}`;
    }

    _resolveStudentName(user) {
        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        return fullName || user.email;
    }

    _resolveOrganizationName(enrollment) {
        if (enrollment.companyContext?.name) return enrollment.companyContext.name;
        if (enrollment.user.company?.name) return enrollment.user.company.name;
        if (enrollment.course.tenant?.name) return enrollment.course.tenant.name;
        return 'LMS Platform';
    }

    _resolveTitle(titleJson, locale = 'it') {
        if (!titleJson) return 'Course';
        if (typeof titleJson === 'string') return titleJson;
        return titleJson[locale] || titleJson.it || titleJson.en || Object.values(titleJson)[0] || 'Course';
    }
}

export const certificateService = new CertificateService();
