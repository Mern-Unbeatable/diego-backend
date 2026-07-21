
import { prisma } from '../../config/db.js';
import { Logger } from '../../config/logger.js';

const log = new Logger('IncomeService');

export class IncomeService {

    _buildPaymentDateFilter(queryParams = {}) {
        const createdAt = {};

        if (queryParams.startDate) {
            createdAt.gte = new Date(queryParams.startDate);
        }

        if (queryParams.endDate) {
            const endDate = new Date(queryParams.endDate);
            endDate.setHours(23, 59, 59, 999);
            createdAt.lte = endDate;
        }

        return Object.keys(createdAt).length > 0 ? createdAt : undefined;
    }

    _extractPaymentCourseContext(payment) {
        if (payment.companyCoursePurchase?.course) {
            return {
                flowType: 'COMPANY_COURSE_PURCHASE',
                courseId: payment.companyCoursePurchase.course.id,
                tenantId: payment.companyCoursePurchase.course.tenantId,
                courseTitle: payment.companyCoursePurchase.course.courseTitle,
                courseSlug: payment.companyCoursePurchase.course.slug,
            };
        }

        if (payment.companyCoursePurchaseRenewal?.companyCoursePurchase?.course) {
            const course = payment.companyCoursePurchaseRenewal.companyCoursePurchase.course;
            return {
                flowType: 'COMPANY_COURSE_RENEWAL',
                courseId: course.id,
                tenantId: course.tenantId,
                courseTitle: course.courseTitle,
                courseSlug: course.slug,
            };
        }

        if (payment.courseRenewal?.enrollment?.course) {
            const course = payment.courseRenewal.enrollment.course;
            return {
                flowType: 'COURSE_RENEWAL',
                courseId: course.id,
                tenantId: course.tenantId,
                courseTitle: course.courseTitle,
                courseSlug: course.slug,
            };
        }

        if (payment.enrollment?.course) {
            const course = payment.enrollment.course;
            return {
                flowType: 'SINGLE_COURSE',
                courseId: course.id,
                tenantId: course.tenantId,
                courseTitle: course.courseTitle,
                courseSlug: course.slug,
            };
        }

        return {
            flowType: payment.type,
            courseId: null,
            tenantId: null,
            courseTitle: null,
            courseSlug: null,
        };
    }

    _classifyPaymentIncome(payment, licenseByTenantId = new Map()) {
        const amount = payment.amount || 0;

        if (payment.type === 'LICENSE') {
            return {
                paymentId: payment.id,
                category: 'PLATFORM_LICENSE',
                flowType: 'LICENSE',
                platformAmount: amount,
                licenseeAmount: 0,
                licenseId: null,
                courseId: null,
                courseTitle: null,
                courseSlug: null,
            };
        }

        const context = this._extractPaymentCourseContext(payment);
        const ownerLicense = context.tenantId ? licenseByTenantId.get(context.tenantId) : null;

        if (ownerLicense) {
            return {
                paymentId: payment.id,
                category: 'LICENSEE_COURSE',
                flowType: context.flowType,
                platformAmount: 0,
                licenseeAmount: amount,
                licenseId: ownerLicense.id,
                courseId: context.courseId,
                courseTitle: context.courseTitle,
                courseSlug: context.courseSlug,
            };
        }

        return {
            paymentId: payment.id,
            category: 'PLATFORM_COURSE',
            flowType: context.flowType,
            platformAmount: amount,
            licenseeAmount: 0,
            licenseId: null,
            courseId: context.courseId,
            courseTitle: context.courseTitle,
            courseSlug: context.courseSlug,
        };
    }

    async _getLicenseMapByTenantIds(tenantIds = []) {
        if (!tenantIds.length) return new Map();

        const licenses = await prisma.license.findMany({
            where: {
                tenantId: { in: tenantIds },
            },
            select: {
                id: true,
                tenantId: true,
                userId: true,
            },
        });

        const map = new Map();
        for (const license of licenses) {
            if (license.tenantId && !map.has(license.tenantId)) {
                map.set(license.tenantId, license);
            }
        }

        return map;
    }

    async _getSuccessfulPayments(queryParams = {}, { skip, take } = {}) {
        const where = { status: 'SUCCESS' };

        if (queryParams.tenantId) where.tenantId = queryParams.tenantId;
        if (queryParams.type) where.type = queryParams.type;

        const dateFilter = this._buildPaymentDateFilter(queryParams);
        if (dateFilter) where.createdAt = dateFilter;

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const payments = await prisma.payment.findMany({
            where,
            orderBy,
            ...(Number.isInteger(skip) ? { skip } : {}),
            ...(Number.isInteger(take) ? { take } : {}),
            include: {
                enrollment: {
                    include: {
                        course: {
                            select: { id: true, tenantId: true, courseTitle: true, slug: true },
                        },
                    },
                },
                courseRenewal: {
                    include: {
                        enrollment: {
                            include: {
                                course: {
                                    select: { id: true, tenantId: true, courseTitle: true, slug: true },
                                },
                            },
                        },
                    },
                },
                companyCoursePurchase: {
                    include: {
                        course: {
                            select: { id: true, tenantId: true, courseTitle: true, slug: true },
                        },
                    },
                },
                companyCoursePurchaseRenewal: {
                    include: {
                        companyCoursePurchase: {
                            include: {
                                course: {
                                    select: { id: true, tenantId: true, courseTitle: true, slug: true },
                                },
                            },
                        },
                    },
                },
            },
        });

        return { where, payments };
    }

    async getIncomeSummary(licenseId = null, user = null) {
        const where = {};

        if (licenseId) {
            where.licenseId = licenseId;
        }

        // Permission check
        if (user?.level === 'LICENSEE') {
            const licensee = await prisma.license.findUnique({
                where: { userId: user.id },
                select: { id: true }
            });
            if (licensee) {
                where.licenseId = licensee.id;
            } else {
                throw new Error('No license found for this user');
            }
        }

        // Get all incomes for monthly calculation
        const allIncomes = await prisma.licenseeIncome.findMany({
            where,
            select: {
                createdAt: true,
                grossAmount: true,
                platformFeeAmount: true,
                licenseeAmount: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Calculate monthly trend
        const monthlyMap = {};
        allIncomes.forEach(income => {
            const month = income.createdAt.toISOString().slice(0, 7);
            if (!monthlyMap[month]) {
                monthlyMap[month] = { gross: 0, fees: 0, net: 0 };
            }
            monthlyMap[month].gross += income.grossAmount || 0;
            monthlyMap[month].fees += income.platformFeeAmount || 0;
            monthlyMap[month].net += income.licenseeAmount || 0;
        });

        const monthlyTrend = Object.keys(monthlyMap)
            .sort((a, b) => b.localeCompare(a))
            .slice(0, 12)
            .map(month => ({
                month: new Date(month + '-01T00:00:00.000Z'),
                gross: monthlyMap[month].gross,
                fees: monthlyMap[month].fees,
                net: monthlyMap[month].net,
            }));

        const [aggregate, courseStats] = await Promise.all([
            prisma.licenseeIncome.aggregate({
                where,
                _sum: {
                    grossAmount: true,
                    platformFeeAmount: true,
                    licenseeAmount: true,
                },
                _count: {
                    _all: true,
                },
            }),
            prisma.licenseeIncome.groupBy({
                by: ['courseId'],
                where,
                _sum: {
                    grossAmount: true,
                    platformFeeAmount: true,
                    licenseeAmount: true,
                },
                _count: {
                    _all: true,
                },
            }),
        ]);

        // Get course details
        const courseIds = courseStats.map(c => c.courseId);
        const courses = await prisma.course.findMany({
            where: { id: { in: courseIds } },
            select: {
                id: true,
                courseTitle: true,
                slug: true,
            }
        });

        const courseMap = {};
        courses.forEach(c => {
            courseMap[c.id] = c;
        });

        return {
            summary: {
                totalTransactions: aggregate._count._all || 0,
                totalGrossAmount: aggregate._sum.grossAmount || 0,
                totalPlatformFees: aggregate._sum.platformFeeAmount || 0,
                totalNetIncome: aggregate._sum.licenseeAmount || 0,
                platformFeePercentage: 20,
            },
            courseBreakdown: courseStats.map(stat => ({
                courseId: stat.courseId,
                courseTitle: courseMap[stat.courseId]?.courseTitle || { en: 'Unknown Course' },
                slug: courseMap[stat.courseId]?.slug || '',
                transactions: stat._count._all,
                grossAmount: stat._sum.grossAmount || 0,
                platformFees: stat._sum.platformFeeAmount || 0,
                netIncome: stat._sum.licenseeAmount || 0,
            })),
            monthlyTrend: monthlyTrend,
        };
    }

    async getIncomeDetails(queryParams = {}, user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};

        // ── Permission Check ──
        if (user?.level === 'LICENSEE') {
            const licensee = await prisma.license.findUnique({
                where: { userId: user.id },
                select: { id: true }
            });
            if (licensee) {
                where.licenseId = licensee.id;
            } else {
                throw new Error('No license found for this user');
            }
        }

        // ── Filters ──
        if (queryParams.licenseId) {
            where.licenseId = queryParams.licenseId;
        }

        if (queryParams.courseId) {
            where.courseId = queryParams.courseId;
        }

        if (queryParams.startDate) {
            where.createdAt = { gte: new Date(queryParams.startDate) };
        }

        if (queryParams.endDate) {
            const endDate = new Date(queryParams.endDate);
            endDate.setHours(23, 59, 59, 999);
            where.createdAt = {
                ...(where.createdAt || {}),
                lte: endDate
            };
        }

        if (queryParams.settled !== undefined) {
            if (queryParams.settled === 'true') {
                where.settledAt = { not: null };
            } else if (queryParams.settled === 'false') {
                where.settledAt = null;
            }
        }

        // ── Sorting ──
        const sortField = queryParams.sortBy || 'createdAt';
        const sortOrder = queryParams.sortOrder || 'desc';

        const validSortFields = ['createdAt', 'grossAmount', 'licenseeAmount', 'platformFeeAmount'];
        const finalSortField = validSortFields.includes(sortField) ? sortField : 'createdAt';

        const orderBy = {
            [finalSortField]: sortOrder === 'asc' ? 'asc' : 'desc'
        };


        const [incomes, total] = await Promise.all([
            prisma.licenseeIncome.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    license: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    email: true,
                                    firstName: true,
                                    lastName: true,
                                }
                            },
                            tenant: {
                                select: {
                                    id: true,
                                    name: true,
                                }
                            }
                        }
                    },
                    course: {
                        select: {
                            id: true,
                            courseTitle: true,
                            slug: true,
                        }
                    },
                    payment: {
                        select: {
                            id: true,
                            amount: true,
                            status: true,
                            createdAt: true,
                        }
                    }
                }
            }),
            prisma.licenseeIncome.count({ where }),
        ]);

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            },
            incomes: incomes.map(income => ({
                id: income.id,
                license: {
                    id: income.license.id,
                    user: income.license.user ? {
                        name: `${income.license.user.firstName || ''} ${income.license.user.lastName || ''}`.trim(),
                        email: income.license.user.email,
                    } : null,
                    tenant: income.license.tenant ? {
                        id: income.license.tenant.id,
                        name: income.license.tenant.name,
                    } : null,
                },
                course: {
                    id: income.course.id,
                    title: income.course.courseTitle,
                    slug: income.course.slug,
                },
                payment: income.payment ? {
                    id: income.payment.id,
                    amount: income.payment.amount,
                    status: income.payment.status,
                    date: income.payment.createdAt,
                } : null,
                grossAmount: income.grossAmount,
                platformFeePercent: income.platformFeePercent,
                platformFeeAmount: income.platformFeeAmount,
                licenseeAmount: income.licenseeAmount,
                currency: income.currency,
                settledAt: income.settledAt,
                createdAt: income.createdAt,
            })),
        };
    }

    async getIncomeByLicenseId(licenseId, queryParams = {}, user = null) {
        // Check permission
        if (user?.level === 'LICENSEE') {
            const licensee = await prisma.license.findUnique({
                where: { userId: user.id },
                select: { id: true }
            });
            if (licensee?.id !== licenseId) {
                throw new Error('Permission denied: You can only view your own income');
            }
        }

        return this.getIncomeDetails({ ...queryParams, licenseId }, user);
    }

    async getLicenseeTotalIncome(userId) {
        const licensee = await prisma.license.findUnique({
            where: { userId },
            select: { id: true }
        });

        if (!licensee) {
            return {
                totalGross: 0,
                totalFees: 0,
                totalNet: 0,
                totalCourses: 0,
                totalTransactions: 0,
            };
        }


        const [aggregate, courseCount] = await Promise.all([
            prisma.licenseeIncome.aggregate({
                where: { licenseId: licensee.id },
                _sum: {
                    grossAmount: true,
                    platformFeeAmount: true,
                    licenseeAmount: true,
                },
                _count: {
                    _all: true,
                },
            }),
            prisma.licenseeIncome.groupBy({
                by: ['courseId'],
                where: { licenseId: licensee.id },
            }),
        ]);

        return {
            totalGross: aggregate._sum.grossAmount || 0,
            totalFees: aggregate._sum.platformFeeAmount || 0,
            totalNet: aggregate._sum.licenseeAmount || 0,
            totalCourses: courseCount.length,
            totalTransactions: aggregate._count._all || 0,
        };
    }

    async getMyIncome(queryParams = {}, userId) {
        const licensee = await prisma.license.findUnique({
            where: { userId },
            select: { id: true },
        });

        if (!licensee) {
            return {
                meta: { page: 1, limit: Math.min(parseInt(queryParams.limit) || 20, 100), total: 0, totalPages: 0 },
                incomes: [],
            };
        }

        return this.getIncomeDetails(
            { ...queryParams, licenseId: licensee.id },
            { id: userId, level: 'LICENSEE' },
        );
    }

    async getMyIncomeSummary(userId) {
        const licensee = await prisma.license.findUnique({
            where: { userId },
            select: { id: true },
        });

        if (!licensee) {
            return {
                summary: {
                    totalTransactions: 0,
                    totalGrossAmount: 0,
                    totalPlatformFees: 0,
                    totalNetIncome: 0,
                    platformFeePercentage: 0,
                },
                courseBreakdown: [],
                monthlyTrend: [],
            };
        }

        return this.getIncomeSummary(licensee.id, { id: userId, level: 'LICENSEE' });
    }

    async getPlatformIncomeSummary(queryParams = {}, user = null) {
        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can view platform income summary.');
        }

        const { payments } = await this._getSuccessfulPayments(queryParams);
        const tenantIds = [...new Set(payments.map((p) => this._extractPaymentCourseContext(p).tenantId).filter(Boolean))];
        const licenseByTenantId = await this._getLicenseMapByTenantIds(tenantIds);

        const rows = payments.map((payment) => this._classifyPaymentIncome(payment, licenseByTenantId));

        const summary = rows.reduce((acc, row) => {
            acc.totalGross += row.platformAmount + row.licenseeAmount;
            acc.platformIncome += row.platformAmount;
            acc.licenseeIncome += row.licenseeAmount;
            acc.totalTransactions += 1;

            if (!acc.byCategory[row.category]) {
                acc.byCategory[row.category] = { transactions: 0, amount: 0 };
            }

            acc.byCategory[row.category].transactions += 1;
            acc.byCategory[row.category].amount += row.platformAmount + row.licenseeAmount;

            if (!acc.byFlowType[row.flowType]) {
                acc.byFlowType[row.flowType] = { transactions: 0, amount: 0 };
            }

            acc.byFlowType[row.flowType].transactions += 1;
            acc.byFlowType[row.flowType].amount += row.platformAmount + row.licenseeAmount;

            return acc;
        }, {
            totalGross: 0,
            platformIncome: 0,
            licenseeIncome: 0,
            totalTransactions: 0,
            byCategory: {},
            byFlowType: {},
        });

        return summary;
    }

    async getPlatformIncomeDetails(queryParams = {}, user = null) {
        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can view platform income details.');
        }

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const [{ where, payments }, total] = await Promise.all([
            this._getSuccessfulPayments(queryParams, { skip, take: limit }),
            prisma.payment.count({
                where: {
                    status: 'SUCCESS',
                    ...(queryParams.tenantId ? { tenantId: queryParams.tenantId } : {}),
                    ...(queryParams.type ? { type: queryParams.type } : {}),
                    ...(this._buildPaymentDateFilter(queryParams) ? { createdAt: this._buildPaymentDateFilter(queryParams) } : {}),
                },
            }),
        ]);

        const tenantIds = [...new Set(payments.map((p) => this._extractPaymentCourseContext(p).tenantId).filter(Boolean))];
        const licenseByTenantId = await this._getLicenseMapByTenantIds(tenantIds);

        const incomes = payments.map((payment) => {
            const classification = this._classifyPaymentIncome(payment, licenseByTenantId);

            return {
                paymentId: payment.id,
                paymentType: payment.type,
                flowType: classification.flowType,
                category: classification.category,
                grossAmount: payment.amount,
                platformAmount: classification.platformAmount,
                licenseeAmount: classification.licenseeAmount,
                licenseId: classification.licenseId,
                courseId: classification.courseId,
                courseTitle: classification.courseTitle,
                courseSlug: classification.courseSlug,
                tenantId: this._extractPaymentCourseContext(payment).tenantId || payment.tenantId || null,
                createdAt: payment.createdAt,
            };
        });

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
            incomes,
        };
    }

    async recordIncome(data) {
        const { licenseId, paymentId, courseId, grossAmount, platformFeePercent = 20 } = data;

        const platformFeeAmount = (grossAmount * platformFeePercent) / 100;
        const licenseeAmount = grossAmount - platformFeeAmount;

        return prisma.licenseeIncome.create({
            data: {
                licenseId,
                paymentId,
                courseId,
                grossAmount,
                platformFeePercent,
                platformFeeAmount,
                licenseeAmount,
                currency: 'EUR',
            },
            include: {
                license: {
                    select: {
                        id: true,
                        userId: true,
                    }
                },
                course: {
                    select: {
                        id: true,
                        courseTitle: true,
                    }
                },
            }
        });
    }


}

export const incomeService = new IncomeService();