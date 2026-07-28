
import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { Logger } from '../../config/logger.js';
import { config } from '../../config/config.js';
import { addYears } from 'date-fns';
import { notificationService } from '../notification/notification.service.js';

const log = new Logger('CertificateService');

export class CertificateService {


    async autoGenerateOnCompletion(enrollmentId) {
        try {
            const enrollment = await prisma.enrollment.findUnique({
                where: { id: enrollmentId },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            tenantId: true,
                            preferredLanguage: true,
                        },
                    },
                    course: {
                        select: {
                            id: true,
                            courseTitle: true,
                            tenantId: true,
                            passScorePercent: true,
                        },
                    },
                },
            });

            if (!enrollment) {
                log.warn(`autoGenerateOnCompletion: Enrollment ${enrollmentId} not found`);
                return null;
            }

            if (enrollment.status !== 'COMPLETED') {
                log.warn(`autoGenerateOnCompletion: Enrollment ${enrollmentId} is not COMPLETED (status: ${enrollment.status})`);
                return null;
            }

            // Avoid duplicate certificates
            const existing = await prisma.certificate.findUnique({
                where: { enrollmentId },
                select: { id: true, status: true, pdfUrl: true },
            });

            if (existing?.status === 'ISSUED') {
                log.info(`Certificate already ISSUED for enrollment ${enrollmentId}`);
                return existing;
            }

            const now = new Date();
            const downloadableUntil = addYears(now, 1);

            const pdfUrl = await this._generatePdf(enrollment, null);
            const qrCode = await this._generateQrCode(enrollment);
            const timestampProof = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;

            const certificateData = {
                enrollmentId,
                userId: enrollment.user.id,
                courseId: enrollment.course.id,
                pdfUrl,
                qrCode,
                timestampProof,
                status: 'ISSUED',
                issuedAt: now,
                downloadableUntil,
                tenantId: enrollment.user.tenantId || enrollment.course.tenantId || null,
            };

            let certificate;
            if (existing) {
                certificate = await prisma.certificate.update({
                    where: { id: existing.id },
                    data: certificateData,
                });
            } else {
                certificate = await prisma.certificate.create({
                    data: certificateData,
                });
            }

            log.info(`Certificate auto-generated: ${certificate.id} for user ${enrollment.user.id}`);



            try {
                const { notificationService } = await import('../notification/notification.service.js');
                const courseTitle = this._resolveTitle(
                    enrollment.course.courseTitle,
                    enrollment.user.preferredLanguage
                );
                notificationService.notifyCertificateReady({
                    userId: enrollment.user.id,
                    courseTitle,
                    tenantId: certificate.tenantId,
                    pdfUrl: certificate.pdfUrl,
                }).catch(err => log.error(`Certificate notification failed: ${err.message}`));
            } catch (err) {
                log.error(`Could not send certificate notification: ${err.message}`);
            }

            return certificate;
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
            const licenseeUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { tenantId: true },
            });
            if (licenseeUser?.tenantId) where.tenantId = licenseeUser.tenantId;
        }

        if (queryParams.userId) where.userId = queryParams.userId;
        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.status) where.status = queryParams.status;
        if (queryParams.archived !== undefined) where.archived = queryParams.archived === 'true';

        if (queryParams.search) {
            where.OR = [
                { user: { email: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { firstName: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { lastName: { contains: queryParams.search, mode: 'insensitive' } } },
            ];
        }

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
            certificates: certificates.map(cert => this._formatCertificate(cert, locale)),
        };
    }
    async getMyCertificates(userId, queryParams = {}, locale = 'it') {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 50);
        const skip = (page - 1) * limit;

        const where = { userId, status: 'ISSUED' };
        if (queryParams.courseId) where.courseId = queryParams.courseId;

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
                    course: {
                        select: { id: true, courseTitle: true, slug: true, thumbnailUrl: true },
                    },
                    enrollment: {
                        select: { completedAt: true },
                    },
                },
            }),
            prisma.certificate.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            certificates: certificates.map(cert => ({
                id: cert.id,
                pdfUrl: cert.pdfUrl,
                qrCode: cert.qrCode,
                companyLogoUrl: cert.companyLogoUrl,
                status: cert.status,
                issuedAt: cert.issuedAt,
                downloadableUntil: cert.downloadableUntil,
                downloadCount: cert.downloadCount,
                lastDownloadedAt: cert.lastDownloadedAt,
                isExpired: cert.downloadableUntil ? new Date() > cert.downloadableUntil : false,
                course: {
                    id: cert.course.id,
                    title: localizeObject(cert.course.courseTitle, locale),
                    slug: cert.course.slug,
                    thumbnailUrl: cert.course.thumbnailUrl,
                },
                completedAt: cert.enrollment?.completedAt ?? null,
            })),
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
                email: certificate.user.email,
            },
            course: {
                id: certificate.course.id,
                title: localizeObject(certificate.course.courseTitle, locale),
                slug: certificate.course.slug,
                description: localizeObject(certificate.course.description, locale),
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
    // generateCertificate  

    async generateCertificate(data, userId) {
        const { enrollmentId, companyLogoUrl, issueDate, expiryDate, forceComplete } = data;

        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        tenantId: true,
                        preferredLanguage: true,
                    },
                },
                course: {
                    select: { id: true, courseTitle: true, tenantId: true },
                },
            },
        });

        if (!enrollment) throw new Error('Enrollment not found');

        const requestingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { level: true, tenantId: true, companyId: true },
        });
        if (!requestingUser) throw new Error('User not found');

        await this._checkGeneratePermission(enrollment, userId, requestingUser);

        // ── Completion check ──
        // COMPANY_ADMIN 
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

            // Force complete
            await prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'COMPLETED', completedAt: new Date() },
            });
            log.info(`Enrollment ${enrollmentId} force-completed by user ${userId}`);
        }

        // Duplicate check
        const existing = await prisma.certificate.findUnique({
            where: { enrollmentId },
            select: { id: true, status: true },
        });
        if (existing?.status === 'ISSUED') {
            throw new Error('Certificate already issued for this enrollment');
        }

        const now = new Date();
        const downloadableUntil = expiryDate ? new Date(expiryDate) : addYears(now, 1);
        const pdfUrl = await this._generatePdf(enrollment, companyLogoUrl);
        const qrCode = await this._generateQrCode(enrollment);
        const timestampProof = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;

        const certificateData = {
            enrollmentId,
            userId: enrollment.user.id,
            courseId: enrollment.course.id,
            pdfUrl,
            qrCode,
            timestampProof,
            companyLogoUrl: companyLogoUrl || null,
            status: 'ISSUED',
            issuedAt: issueDate ? new Date(issueDate) : now,
            downloadableUntil,
            tenantId: enrollment.user.tenantId || enrollment.course.tenantId || null,
        };

        let certificate;
        if (existing) {
            certificate = await prisma.certificate.update({
                where: { id: existing.id },
                data: certificateData,
                include: {
                    user: { select: { id: true, email: true, firstName: true, lastName: true } },
                    course: { select: { id: true, courseTitle: true, slug: true } },
                    enrollment: { select: { status: true, completedAt: true } },
                },
            });
        } else {
            certificate = await prisma.certificate.create({
                data: certificateData,
                include: {
                    user: { select: { id: true, email: true, firstName: true, lastName: true } },
                    course: { select: { id: true, courseTitle: true, slug: true } },
                    enrollment: { select: { status: true, completedAt: true } },
                },
            });
        }

        log.info(`Certificate generated: ${certificate.id} by user ${userId}`);

        // Notify
        try {

            const courseTitle = this._resolveTitle(
                enrollment.course.courseTitle,
                enrollment.user.preferredLanguage
            );
            notificationService.notifyCertificateReady({
                userId: enrollment.user.id,
                courseTitle,
                tenantId: certificate.tenantId,
                pdfUrl: certificate.pdfUrl,
            }).catch(err => log.error(`Certificate notification failed: ${err.message}`));
        } catch (err) {
            log.error(`Could not send certificate notification: ${err.message}`);
        }

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
    async downloadCertificate(id, userId) {
        const certificate = await prisma.certificate.findUnique({
            where: { id },
            select: {
                id: true,
                userId: true,
                pdfUrl: true,
                downloadCount: true,
                status: true,
                downloadableUntil: true,
            },
        });

        if (!certificate) throw new Error('Certificate not found');
        if (certificate.userId !== userId) {
            throw new Error('Permission denied: You can only download your own certificates');
        }
        if (certificate.status !== 'ISSUED') {
            throw new Error(`Certificate is ${certificate.status.toLowerCase()} and cannot be downloaded`);
        }
        if (certificate.downloadableUntil && new Date() > certificate.downloadableUntil) {
            throw new Error('Certificate download link has expired. Please purchase archive storage to access it.');
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
            },
        });

        if (!certificate) return { valid: false, message: 'Certificate not found' };
        if (certificate.status !== 'ISSUED') {
            return { valid: false, message: `Certificate is ${certificate.status.toLowerCase()}` };
        }
        if (certificate.archived) {
            return { valid: false, message: 'Certificate has been archived' };
        }

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
                issuedAt: certificate.issuedAt,
                completedAt: certificate.enrollment?.completedAt ?? null,
                qrCode: certificate.qrCode,
                timestampProof: certificate.timestampProof,
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

        return prisma.certificate.delete({
            where: { id },
            select: { id: true, userId: true, courseId: true },
        });
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
                email: cert.user.email,
                level: cert.user.level,
            },
            course: {
                id: cert.course.id,
                title: localizeObject(cert.course.courseTitle, locale),
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

    async _checkViewPermission(certificate, user) {
        if (!user) throw new Error('Authentication required');
        if (user.level === 'PLATFORM_ADMIN') return;
        if (certificate.userId === user.id) return;

        if (user.level === 'LICENSE_USER') {
            const licenseeUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { tenantId: true },
            });
            if (licenseeUser?.tenantId && licenseeUser.tenantId === certificate.tenantId) return;
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


        if (requestingUser.level === 'PLATFORM_ADMIN') return;


        if (requestingUser.level === 'LICENSEE') {
            const inTenant =
                requestingUser.tenantId === enrollment.user.tenantId ||
                requestingUser.tenantId === enrollment.course.tenantId;
            if (inTenant) return;
            throw new Error('Permission denied: User is not in your tenant');
        }


        if (requestingUser.level === 'COMPANY_ADMIN') {
            if (!requestingUser.companyId) throw new Error('Company Admin has no company assigned');

            // enrolled user
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

    // Stub: replace with real PDF generation
    async _generatePdf(enrollment, companyLogoUrl) {
        const baseUrl = config.BACKEND_URL || 'http://localhost:3000';
        return `${baseUrl}/uploads/certificates/${enrollment.id}-${Date.now()}.pdf`;
    }

    // QR code pointing to the public verify endpoint
    async _generateQrCode(enrollment) {
        const verifyUrl = `${config.CLIENT_URL || 'http://localhost:5173'}/verify/${enrollment.id}`;
        return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verifyUrl)}`;
    }

    // Safely resolve a localized JSON title field
    _resolveTitle(titleJson, locale = 'it') {
        if (!titleJson) return 'Course';
        if (typeof titleJson === 'string') return titleJson;
        return titleJson[locale] || titleJson['it'] || titleJson['en'] || Object.values(titleJson)[0] || 'Course';
    }
}

export const certificateService = new CertificateService();














