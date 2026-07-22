
import { prisma } from '../../config/db.js';
import { Logger } from '../../config/logger.js';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { it, enUS } from 'date-fns/locale';
import { PLATFORM_FEE_PERCENT, INCOME_CATEGORIES, CHART_PERIOD_OPTIONS, CHART_SERIES_OPTIONS } from './Income.constants.js';

const log = new Logger('IncomeService');

const DAY_LABEL_LOCALES = { it, en: enUS };

export class IncomeService {

    _percentChange(current, previous) {
        const cur = Number(current) || 0;
        const prev = Number(previous) || 0;
        if (prev === 0) return cur > 0 ? 100 : 0;
        return Number((((cur - prev) / prev) * 100).toFixed(1));
    }

    _splitPlatformFee(grossAmount) {
        const amount = Number(grossAmount) || 0;
        const platformFeeAmount = (amount * PLATFORM_FEE_PERCENT) / 100;
        return {
            platformAmount: Number(platformFeeAmount.toFixed(2)),
            licenseeAmount: Number((amount - platformFeeAmount).toFixed(2)),
        };
    }

    _resolvePeriodRange(periodDays = 30) {
        const days = Math.max(1, Number(periodDays) || 30);
        const now = new Date();
        const currentStart = startOfDay(subDays(now, days - 1));
        const currentEnd = endOfDay(now);
        const previousStart = startOfDay(subDays(currentStart, days));
        const previousEnd = endOfDay(subDays(currentStart, 1));
        return { days, currentStart, currentEnd, previousStart, previousEnd };
    }

    _buildDailyChart(rows, days, locale = 'it', anchorEnd = new Date()) {
        const dateLocale = DAY_LABEL_LOCALES[locale] || DAY_LABEL_LOCALES.it;
        const buckets = [];

        for (let i = days - 1; i >= 0; i--) {
            const day = startOfDay(subDays(anchorEnd, i));
            const key = format(day, 'yyyy-MM-dd');
            buckets.push({ date: key, label: format(day, 'EEE', { locale: dateLocale }), amount: 0 });
        }

        const bucketMap = Object.fromEntries(buckets.map((b) => [b.date, b]));
        for (const row of rows) {
            const key = format(new Date(row.date), 'yyyy-MM-dd');
            if (bucketMap[key]) bucketMap[key].amount += row.amount;
        }

        return buckets.map((b) => ({
            date: b.date,
            label: b.label.charAt(0).toUpperCase() + b.label.slice(1),
            amount: Number(b.amount.toFixed(2)),
        }));
    }

    /**
     * Build aligned current vs previous period charts for comparison.
     * X-axis labels come from the CURRENT period; previous amounts map to the
     * corresponding day offset in the prior period (not the same calendar dates).
     */
    _buildComparisonChart(currentRows, previousRows, days, locale = 'it') {
        const dateLocale = DAY_LABEL_LOCALES[locale] || DAY_LABEL_LOCALES.it;
        const now = new Date();
        const currentBuckets = [];
        const previousBuckets = [];

        for (let i = days - 1; i >= 0; i--) {
            const currentDay = startOfDay(subDays(now, i));
            const previousDay = startOfDay(subDays(currentDay, days));
            const label = format(currentDay, 'EEE', { locale: dateLocale });
            const formattedLabel = label.charAt(0).toUpperCase() + label.slice(1);

            currentBuckets.push({
                date: format(currentDay, 'yyyy-MM-dd'),
                label: formattedLabel,
                amount: 0,
            });
            previousBuckets.push({
                date: format(previousDay, 'yyyy-MM-dd'),
                label: formattedLabel,
                amount: 0,
            });
        }

        const currentMap = Object.fromEntries(currentBuckets.map((b) => [b.date, b]));
        const previousMap = Object.fromEntries(previousBuckets.map((b) => [b.date, b]));

        for (const row of currentRows) {
            const key = format(new Date(row.date), 'yyyy-MM-dd');
            if (currentMap[key]) currentMap[key].amount += row.amount;
        }

        for (const row of previousRows) {
            const key = format(new Date(row.date), 'yyyy-MM-dd');
            if (previousMap[key]) previousMap[key].amount += row.amount;
        }

        const formatBuckets = (buckets) => buckets.map((b) => ({
            date: b.date,
            label: b.label,
            amount: Number(b.amount.toFixed(2)),
        }));

        return {
            current: formatBuckets(currentBuckets),
            previous: formatBuckets(previousBuckets),
        };
    }

    _resolveChartPeriod(chartDays = 7) {
        const days = CHART_PERIOD_OPTIONS.includes(chartDays) ? chartDays : 7;
        const now = new Date();
        const currentStart = startOfDay(subDays(now, days - 1));
        const currentEnd = endOfDay(now);
        const previousStart = startOfDay(subDays(currentStart, days));
        const previousEnd = endOfDay(subDays(currentStart, 1));
        return { days, now, currentStart, currentEnd, previousStart, previousEnd };
    }

    _buildSalesChartData(chart, series) {
        if (series === 'current') {
            return chart.current.map((point) => ({
                date: point.date,
                label: point.label,
                amount: point.amount,
            }));
        }

        if (series === 'previous') {
            return chart.previous.map((point, index) => ({
                date: point.date,
                label: chart.current[index]?.label || point.label,
                amount: point.amount,
            }));
        }

        return chart.current.map((point, index) => ({
            label: point.label,
            date: point.date,
            current: point.amount,
            previous: chart.previous[index]?.amount ?? 0,
        }));
    }

    _buildSalesChartResponse({ chart, series, chartDays, currentTotal, previousTotal }) {
        const data = this._buildSalesChartData(chart, series);
        const base = {
            chartDays,
            series,
            chartDaysOptions: CHART_PERIOD_OPTIONS,
            data,
        };

        if (series === 'both') {
            return {
                ...base,
                currentTotal: Number(currentTotal.toFixed(2)),
                previousTotal: Number(previousTotal.toFixed(2)),
                changePercent: this._percentChange(currentTotal, previousTotal),
            };
        }

        const total = series === 'current' ? currentTotal : previousTotal;
        return {
            ...base,
            total: Number(total.toFixed(2)),
        };
    }

    async _getLicenseForUser(userId) {
        return prisma.license.findUnique({
            where: { userId },
            select: {
                id: true,
                tenantId: true,
                maxCourses: true,
                maxUsers: true,
                expiresAt: true,
                isSuspended: true,
                tenant: {
                    select: {
                        id: true,
                        _count: { select: { courses: true, users: true } },
                    },
                },
            },
        });
    }

    async _getLicenseeCourseIds(tenantId) {
        if (!tenantId) return [];
        const courses = await prisma.course.findMany({
            where: { tenantId },
            select: { id: true },
        });
        return courses.map((c) => c.id);
    }

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
        const base = {
            paymentId: payment.id,
            flowType: payment.type,
            licenseId: null,
            courseId: null,
            courseTitle: null,
            courseSlug: null,
        };

        if (payment.type === 'LICENSE') {
            return {
                ...base,
                category: INCOME_CATEGORIES.PLATFORM_LICENSE,
                flowType: 'LICENSE',
                platformAmount: amount,
                licenseeAmount: 0,
            };
        }

        if (payment.type === 'ARCHIVE_STORAGE') {
            return {
                ...base,
                category: INCOME_CATEGORIES.PLATFORM_ARCHIVE,
                flowType: 'ARCHIVE_STORAGE',
                platformAmount: amount,
                licenseeAmount: 0,
            };
        }

        const context = this._extractPaymentCourseContext(payment);
        const ownerLicense = context.tenantId ? licenseByTenantId.get(context.tenantId) : null;

        if (ownerLicense) {
            const split = this._splitPlatformFee(amount);
            return {
                ...base,
                category: INCOME_CATEGORIES.LICENSE_USER_COURSE,
                flowType: context.flowType,
                platformAmount: split.platformAmount,
                licenseeAmount: split.licenseeAmount,
                licenseId: ownerLicense.id,
                courseId: context.courseId,
                courseTitle: context.courseTitle,
                courseSlug: context.courseSlug,
            };
        }

        if (payment.type === 'PACKAGE') {
            return {
                ...base,
                category: INCOME_CATEGORIES.PLATFORM_PACKAGE,
                flowType: 'PACKAGE',
                platformAmount: amount,
                licenseeAmount: 0,
            };
        }

        return {
            ...base,
            category: INCOME_CATEGORIES.PLATFORM_COURSE,
            flowType: context.flowType,
            platformAmount: amount,
            licenseeAmount: 0,
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
        if (user?.level === 'LICENSE_USER') {
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
                platformFeePercentage: PLATFORM_FEE_PERCENT,
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
        if (user?.level === 'LICENSE_USER') {
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
        if (user?.level === 'LICENSE_USER') {
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
            { id: userId, level: 'LICENSE_USER' },
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

        return this.getIncomeSummary(licensee.id, { id: userId, level: 'LICENSE_USER' });
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

    /**
     * LICENSE_USER home dashboard — Total sold, new users, courses, students, tickets.
     */
    async getLicenseUserDashboard(userId, queryParams = {}) {
        const license = await this._getLicenseForUser(userId);
        if (!license) {
            return {
                totalSold: { amount: 0, currency: 'EUR', changePercent: 0, periodDays: 30 },
                newUsers: { total: 0, thisWeek: 0, changePercent: 0 },
                myCourses: { used: 0, limit: 0, percentUsed: 0 },
                activeStudents: { active: 0, limit: 0, percentUsed: 0 },
                myTickets: { open: 0 },
            };
        }

        const { days, currentStart, previousStart, previousEnd } = this._resolvePeriodRange(queryParams.periodDays || 30);
        const weekStart = startOfDay(subDays(new Date(), 6));
        const courseIds = await this._getLicenseeCourseIds(license.tenantId);

        const [
            currentIncome,
            previousIncome,
            totalTenantUsers,
            newUsersThisWeek,
            newUsersLastWeek,
            activeStudentRows,
            openTickets,
        ] = await Promise.all([
            prisma.licenseeIncome.aggregate({
                where: { licenseId: license.id, createdAt: { gte: currentStart } },
                _sum: { licenseeAmount: true },
            }),
            prisma.licenseeIncome.aggregate({
                where: { licenseId: license.id, createdAt: { gte: previousStart, lte: previousEnd } },
                _sum: { licenseeAmount: true },
            }),
            prisma.user.count({ where: { tenantId: license.tenantId } }),
            prisma.user.count({ where: { tenantId: license.tenantId, createdAt: { gte: weekStart } } }),
            prisma.user.count({
                where: {
                    tenantId: license.tenantId,
                    createdAt: { gte: subDays(weekStart, 7), lt: weekStart },
                },
            }),
            courseIds.length
                ? prisma.enrollment.findMany({
                    where: { courseId: { in: courseIds }, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
                    select: { userId: true },
                    distinct: ['userId'],
                })
                : Promise.resolve([]),
            prisma.supportTicket.count({
                where: { userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
            }),
        ]);

        const coursesUsed = license.tenant?._count?.courses ?? 0;
        const courseLimit = license.maxCourses || 0;
        const studentLimit = license.maxUsers || 0;
        const activeCount = activeStudentRows.length;

        return {
            totalSold: {
                amount: currentIncome._sum.licenseeAmount || 0,
                currency: 'EUR',
                changePercent: this._percentChange(
                    currentIncome._sum.licenseeAmount || 0,
                    previousIncome._sum.licenseeAmount || 0,
                ),
                periodDays: days,
            },
            newUsers: {
                total: totalTenantUsers,
                thisWeek: newUsersThisWeek,
                changePercent: this._percentChange(newUsersThisWeek, newUsersLastWeek),
            },
            myCourses: {
                used: coursesUsed,
                limit: courseLimit,
                percentUsed: courseLimit > 0 ? Number(((coursesUsed / courseLimit) * 100).toFixed(1)) : 0,
            },
            activeStudents: {
                active: activeCount,
                limit: studentLimit,
                percentUsed: studentLimit > 0 ? Number(((activeCount / studentLimit) * 100).toFixed(1)) : 0,
            },
            myTickets: { open: openTickets },
        };
    }

    /**
     * LICENSE_USER report page — sales chart (current vs previous period).
     */
    async getLicenseUserReport(userId, queryParams = {}, locale = 'it') {
        const license = await this._getLicenseForUser(userId);
        const { days, currentStart, currentEnd, previousStart, previousEnd } = this._resolveChartPeriod(queryParams.chartDays);
        const series = queryParams.series || 'both';

        const emptyChart = this._buildSalesChartResponse({
            chart: { current: [], previous: [] },
            series,
            chartDays: days,
            currentTotal: 0,
            previousTotal: 0,
        });

        if (!license) {
            return {
                ...emptyChart,
                seriesOptions: (CHART_SERIES_OPTIONS[locale] || CHART_SERIES_OPTIONS.it),
            };
        }

        const includeCurrent = series === 'current' || series === 'both';
        const includePrevious = series === 'previous' || series === 'both';

        const [currentIncomes, previousIncomes] = await Promise.all([
            includeCurrent
                ? prisma.licenseeIncome.findMany({
                    where: { licenseId: license.id, createdAt: { gte: currentStart, lte: currentEnd } },
                    select: { createdAt: true, licenseeAmount: true },
                })
                : Promise.resolve([]),
            includePrevious
                ? prisma.licenseeIncome.findMany({
                    where: { licenseId: license.id, createdAt: { gte: previousStart, lte: previousEnd } },
                    select: { createdAt: true, licenseeAmount: true },
                })
                : Promise.resolve([]),
        ]);

        const mapIncomeRows = (rows) => rows.map((r) => ({
            date: r.createdAt,
            amount: r.licenseeAmount || 0,
        }));

        const currentTotal = currentIncomes.reduce((s, r) => s + (r.licenseeAmount || 0), 0);
        const previousTotal = previousIncomes.reduce((s, r) => s + (r.licenseeAmount || 0), 0);
        const chart = this._buildComparisonChart(
            mapIncomeRows(currentIncomes),
            mapIncomeRows(previousIncomes),
            days,
            locale,
        );

        return {
            ...this._buildSalesChartResponse({
                chart,
                series,
                chartDays: days,
                currentTotal,
                previousTotal,
            }),
            seriesOptions: CHART_SERIES_OPTIONS[locale] || CHART_SERIES_OPTIONS.it,
        };
    }

    /**
     * PLATFORM_ADMIN home dashboard — turnover, users, licenses, courses.
     */
    async getPlatformAdminDashboard(queryParams = {}, user = null) {
        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can view platform dashboard.');
        }

        const { days, currentStart, previousStart, previousEnd } = this._resolvePeriodRange(queryParams.periodDays || 30);
        const weekStart = startOfDay(subDays(new Date(), 6));

        const [
            currentPayments,
            previousPayments,
            totalActiveUsers,
            usersCurrentPeriod,
            usersPreviousPeriod,
            allLicenses,
            activeLicenses,
            trialLicenses,
            totalCourses,
            platformCourses,
            newLicensesCurrent,
            newLicensesPrevious,
            newUsersThisWeek,
            newLicensesThisWeek,
        ] = await Promise.all([
            this._getSuccessfulPayments({ startDate: currentStart, endDate: new Date() }),
            this._getSuccessfulPayments({ startDate: previousStart, endDate: previousEnd }),
            prisma.user.count({ where: { isActive: true, status: 'ACTIVE' } }),
            prisma.user.count({ where: { isActive: true, status: 'ACTIVE', createdAt: { gte: currentStart } } }),
            prisma.user.count({ where: { isActive: true, status: 'ACTIVE', createdAt: { gte: previousStart, lte: previousEnd } } }),
            prisma.license.count(),
            prisma.license.count({
                where: { isSuspended: false, expiresAt: { gt: new Date() } },
            }),
            prisma.license.count({
                where: {
                    isSuspended: false,
                    OR: [
                        { priceAtPurchase: 0 },
                        { plan: { tier: 'BEGINNER' } },
                    ],
                },
            }),
            prisma.course.count(),
            prisma.course.count({ where: { tenantId: null } }),
            prisma.license.count({ where: { createdAt: { gte: currentStart } } }),
            prisma.license.count({ where: { createdAt: { gte: previousStart, lte: previousEnd } } }),
            prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
            prisma.license.count({ where: { createdAt: { gte: weekStart } } }),
        ]);

        const tenantIds = [
            ...new Set(
                [...currentPayments.payments, ...previousPayments.payments]
                    .map((p) => this._extractPaymentCourseContext(p).tenantId)
                    .filter(Boolean),
            ),
        ];
        const licenseByTenantId = await this._getLicenseMapByTenantIds(tenantIds);

        const sumPlatformIncome = (payments) => payments.reduce((sum, payment) => {
            const row = this._classifyPaymentIncome(payment, licenseByTenantId);
            return sum + row.platformAmount;
        }, 0);

        const currentTurnover = sumPlatformIncome(currentPayments.payments);
        const previousTurnover = sumPlatformIncome(previousPayments.payments);

        const turnoverByCategory = currentPayments.payments.reduce((acc, payment) => {
            const row = this._classifyPaymentIncome(payment, licenseByTenantId);
            if (!acc[row.category]) acc[row.category] = 0;
            acc[row.category] += row.platformAmount;
            return acc;
        }, {});

        return {
            platformTurnover: {
                amount: Number(currentTurnover.toFixed(2)),
                currency: 'EUR',
                periodDays: days,
                changePercent: this._percentChange(currentTurnover, previousTurnover),
                breakdown: turnoverByCategory,
            },
            totalActiveUsers: {
                total: totalActiveUsers,
                newInPeriod: usersCurrentPeriod,
                changePercent: this._percentChange(usersCurrentPeriod, usersPreviousPeriod),
            },
            totalLicenses: {
                total: allLicenses,
                active: activeLicenses,
                onTrial: trialLicenses,
                changePercent: this._percentChange(newLicensesCurrent, newLicensesPrevious),
            },
            healthStatus: {
                uptimePercent: 99.97,
                changePercent: 0.02,
            },
            courses: {
                totalLoaded: platformCourses,
                totalOnPlatform: totalCourses,
            },
            recentActivity: {
                newUsersThisWeek: newUsersThisWeek,
                newLicensesThisWeek: newLicensesThisWeek,
            },
        };
    }

    /**
     * PLATFORM_ADMIN report — turnover chart + income breakdown by source.
     */
    async getPlatformAdminReport(queryParams = {}, user = null) {
        if (user?.level !== 'PLATFORM_ADMIN') {
            throw new Error('Only Platform Admin can view platform report.');
        }

        const { days, currentStart, currentEnd, previousStart, previousEnd } = this._resolveChartPeriod(queryParams.chartDays || 7);
        const locale = queryParams.locale || 'it';
        const series = queryParams.series || 'both';

        const includeCurrent = series === 'current' || series === 'both';
        const includePrevious = series === 'previous' || series === 'both';

        const [{ payments: currentPayments }, { payments: previousPayments }] = await Promise.all([
            includeCurrent
                ? this._getSuccessfulPayments({ startDate: currentStart, endDate: currentEnd })
                : Promise.resolve({ payments: [] }),
            includePrevious
                ? this._getSuccessfulPayments({ startDate: previousStart, endDate: previousEnd })
                : Promise.resolve({ payments: [] }),
        ]);

        const tenantIds = [
            ...new Set(
                [...currentPayments, ...previousPayments]
                    .map((p) => this._extractPaymentCourseContext(p).tenantId)
                    .filter(Boolean),
            ),
        ];
        const licenseByTenantId = await this._getLicenseMapByTenantIds(tenantIds);

        const toChartRows = (payments) => payments.map((payment) => {
            const row = this._classifyPaymentIncome(payment, licenseByTenantId);
            return { date: payment.createdAt, amount: row.platformAmount };
        });

        const currentTotal = toChartRows(currentPayments).reduce((s, r) => s + r.amount, 0);
        const previousTotal = toChartRows(previousPayments).reduce((s, r) => s + r.amount, 0);
        const chart = this._buildComparisonChart(
            toChartRows(currentPayments),
            toChartRows(previousPayments),
            days,
            locale,
        );

        const bySource = currentPayments.reduce((acc, payment) => {
            const row = this._classifyPaymentIncome(payment, licenseByTenantId);
            if (!acc[row.category]) acc[row.category] = { transactions: 0, amount: 0 };
            acc[row.category].transactions += 1;
            acc[row.category].amount += row.platformAmount;
            return acc;
        }, {});

        return {
            ...this._buildSalesChartResponse({
                chart,
                series,
                chartDays: days,
                currentTotal,
                previousTotal,
            }),
            seriesOptions: CHART_SERIES_OPTIONS[locale] || CHART_SERIES_OPTIONS.it,
            incomeBySource: Object.entries(bySource).map(([category, data]) => ({
                category,
                transactions: data.transactions,
                amount: Number(data.amount.toFixed(2)),
            })),
        };
    }

    async recordIncome(data) {
        const { licenseId, paymentId, courseId, grossAmount, platformFeePercent = PLATFORM_FEE_PERCENT } = data;

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