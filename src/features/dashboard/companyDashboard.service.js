import { prisma } from '../../config/db.js';

const EXPIRING_SOON_DAYS = 14;

class CompanyDashboardService {

    async _resolveCompanyContext(adminUser) {
        const companyId = adminUser.companyId
            ?? (await prisma.user.findUnique({
                where: { id: adminUser.id },
                select: { companyId: true },
            }))?.companyId;

        if (!companyId) throw new Error('Company Admin has no company assigned');

        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: { id: true, name: true, logoUrl: true },
        });
        if (!company) throw new Error('Company not found');

        return { companyId, company };
    }

    async getDashboard(adminUser, queryParams = {}) {
        const { companyId, company } = await this._resolveCompanyContext(adminUser);
        const now = new Date();
        const expiringSoonDate = new Date(now);
        expiringSoonDate.setDate(expiringSoonDate.getDate() + (queryParams.expiringDays ?? EXPIRING_SOON_DAYS));

        const employeeWhere = { companyId, level: 'COMPANY_EMPLOYEE' };
        const enrollmentBaseWhere = {
            companyContextId: companyId,
            user: employeeWhere,
        };

        const [
            adminProfile,
            totalUsers,
            activeEmployees,
            activeCourseRows,
            expiringSoon,
            completedCourses,
            myTickets,
            totalCertificates,
            seatsPurchases,
            enrollmentStatusBreakdown,
        ] = await Promise.all([
            prisma.user.findUnique({
                where: { id: adminUser.id },
                select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
            }),
            prisma.user.count({ where: employeeWhere }),
            prisma.user.count({
                where: { ...employeeWhere, status: 'ACTIVE', isActive: true },
            }),
            prisma.enrollment.findMany({
                where: {
                    ...enrollmentBaseWhere,
                    status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
                    expiresAt: { gt: now },
                },
                select: { courseId: true },
                distinct: ['courseId'],
            }),
            prisma.enrollment.count({
                where: {
                    ...enrollmentBaseWhere,
                    status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
                    expiresAt: { gte: now, lte: expiringSoonDate },
                },
            }),
            prisma.enrollment.count({
                where: { ...enrollmentBaseWhere, status: 'COMPLETED' },
            }),
            prisma.supportTicket.count({
                where: {
                    userId: adminUser.id,
                    status: { in: ['OPEN', 'IN_PROGRESS'] },
                },
            }),
            prisma.certificate.count({
                where: {
                    user: employeeWhere,
                    status: 'ISSUED',
                },
            }),
            prisma.companyCoursePurchase.findMany({
                where: { companyId, expiresAt: { gt: now } },
                select: { seatsTotal: true, seatsUsed: true, courseId: true },
            }),
            prisma.enrollment.groupBy({
                by: ['status'],
                where: enrollmentBaseWhere,
                _count: { _all: true },
            }),
        ]);

        const fullName = `${adminProfile?.firstName || ''} ${adminProfile?.lastName || ''}`.trim()
            || adminProfile?.email
            || 'Admin';

        const seatsTotal = seatsPurchases.reduce((s, p) => s + p.seatsTotal, 0);
        const seatsUsed = seatsPurchases.reduce((s, p) => s + p.seatsUsed, 0);

        return {
            greeting: {
                firstName: adminProfile?.firstName ?? null,
                lastName: adminProfile?.lastName ?? null,
                fullName,
                message: `Hi ${fullName}`,
                avatar: adminProfile?.avatar ?? null,
            },
            company: {
                id: company.id,
                name: company.name,
                logoUrl: company.logoUrl,
            },
            cards: {
                totalUsers,
                activeCourses: activeCourseRows.length,
                expiringSoon,
                completedCourses,
                myTickets,
            },
            stats: {
                activeEmployees,
                totalCertificates,
                totalEnrollments: enrollmentStatusBreakdown.reduce((s, r) => s + r._count._all, 0),
                seatsTotal,
                seatsUsed,
                seatsAvailable: seatsTotal - seatsUsed,
                purchasedCourses: new Set(seatsPurchases.map((p) => p.courseId)).size,
                enrollmentStatusBreakdown: enrollmentStatusBreakdown.reduce((acc, row) => {
                    acc[row.status] = row._count._all;
                    return acc;
                }, {}),
            },
        };
    }
}

export const companyDashboardService = new CompanyDashboardService();
