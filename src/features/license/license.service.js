import { prisma } from '../../config/db.js';
import { addDays, differenceInDays } from 'date-fns';
import bcrypt from 'bcryptjs';
import { Logger } from '../../config/logger.js';
import { paymentService } from '../payment/payment.service.js';

const log = new Logger('LicenseService');

class LicenseService {

    async createLicense(data, requestingUser = null) {
        const {
            email,
            firstName,
            lastName,
            password,
            userId: existingUserId,
            companyName,
            phoneNumber,
            emailAddress,
            certifiedEmail,
            subdomain,
            customDomain,
            planTier,
            vatNumber,
            vatPercentage = 22,
            durationDays = 365,
            autoRenew = false,
            billingCycle = 'YEARLY',
        } = data;

        const plan = await prisma.licensePlan.findUnique({
            where: { tier: planTier },
        });
        if (!plan) throw new Error(`License plan "${planTier}" not found.`);
        if (!plan.isActive) throw new Error(`License plan "${planTier}" is currently inactive.`);

        if (subdomain) {
            const clash = await prisma.license.findUnique({ where: { subdomain }, select: { id: true } });
            if (clash) throw new Error('Subdomain is already taken.');
        }
        if (customDomain) {
            const clash = await prisma.license.findUnique({ where: { customDomain }, select: { id: true } });
            if (clash) throw new Error('Custom domain is already in use.');
        }

        if (!subdomain || !customDomain) {
            throw new Error('subdomain and customDomain are required.');
        }

        const price = billingCycle === 'MONTHLY'
            ? plan.priceMonthly
            : (plan.priceAnnual || plan.priceYearly || plan.priceMonthly * 12);

        let userId = existingUserId;
        let tenantId = null;

        // ── TRANSACTION 1: Create User & Tenant (Fast DB operations) ──
        await prisma.$transaction(async (tx) => {
            if (!userId) {
                if (!email) throw new Error('Either userId or email must be provided.');
                const existing = await tx.user.findUnique({ where: { email }, select: { id: true, level: true } });
                if (existing) {
                    if (existing.level !== 'LICENSEE') {
                        throw new Error(`User ${email} already exists but is not a LICENSEE.`);
                    }
                    const hasLicense = await tx.license.findUnique({ where: { userId: existing.id }, select: { id: true } });
                    if (hasLicense) throw new Error(`User ${email} already has a license.`);
                    userId = existing.id;
                } else {
                    const hashed = await bcrypt.hash(password || this._generateTempPassword(), 10);
                    const newUser = await tx.user.create({
                        data: {
                            email,
                            password: hashed,
                            firstName: firstName ?? null,
                            lastName: lastName ?? null,
                            level: 'LICENSEE',
                            status: 'ACTIVE',
                            isVerified: true,
                            isActive: true,
                            verifiedAt: new Date(),
                            profileCompleted: !!(firstName && lastName),
                            consentGiven: true,
                            consentDate: new Date(),
                            companyName: companyName ?? null,
                        },
                    });
                    userId = newUser.id;
                }
            } else {
                const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, level: true } });
                if (!user) throw new Error('User not found.');
                if (user.level !== 'LICENSEE') throw new Error('Only LICENSEE users can hold a license.');
                const hasLicense = await tx.license.findUnique({ where: { userId }, select: { id: true } });
                if (hasLicense) throw new Error('This user already has a license.');
            }

            const tenantSubdomain = subdomain;
            const tenantDomain = customDomain;

            const tenant = await tx.tenant.create({
                data: {
                    name: `${companyName} Academy`,
                    subdomain: tenantSubdomain,
                    customDomain: tenantDomain,
                    primaryColor: '#0F62FE',
                    isActive: true,
                    ownerId: userId,
                },
            });

            await tx.user.update({
                where: { id: userId },
                data: { tenantId: tenant.id },
            });

            tenantId = tenant.id;
        });

        // ── OUTSIDE TRANSACTION: Create Payment (Calls Stripe API - Slow) ──
        const payment = await paymentService.createLicensePayment({
            userId,
            licenseId: null, // License not created yet
            planId: plan.id,
            amount: price,
            billingCycle,
            couponCode: data.couponCode,
            vatPercentage,
            tenantId: tenantId,
        });

        // ── TRANSACTION 2: Create License and Link Payment (Fast DB operations) ──
        const tenantSubdomain = subdomain;
        const tenantDomain = customDomain;

        const license = await prisma.$transaction(async (tx) => {
            const hasLicense = await tx.license.findUnique({ where: { userId }, select: { id: true } });
            if (hasLicense) {
                return tx.license.update({
                    where: { id: hasLicense.id },
                    data: { paymentId: payment.id },
                    include: {
                        user: { select: { id: true, email: true, firstName: true, lastName: true } },
                        tenant: { select: { id: true, name: true, subdomain: true, customDomain: true } },
                        plan: true,
                    },
                });
            }

            const startsAt = new Date();
            const expiresAt = addDays(startsAt, durationDays);

            return tx.license.create({
                data: {
                    userId,
                    tenantId: tenantId,
                    planId: plan.id,
                    companyName,
                    phoneNumber: phoneNumber ?? null,
                    emailAddress: emailAddress ?? null,
                    certifiedEmail: certifiedEmail ?? null,
                    subdomain: tenantSubdomain,
                    customDomain: tenantDomain,
                    billingCycle,
                    maxUsers: plan.maxUsers,
                    maxCourses: plan.maxCourses,
                    storageMb: plan.storageMb,
                    vatNumber: vatNumber ?? null,
                    vatPercentage,
                    priceAtPurchase: price,
                    startsAt,
                    expiresAt,
                    autoRenew,
                    isSuspended: false,
                    paymentId: payment.id,
                },
                include: {
                    user: { select: { id: true, email: true, firstName: true, lastName: true } },
                    tenant: { select: { id: true, name: true, subdomain: true, customDomain: true } },
                    plan: true,
                },
            });
        });

        log.info(`License created: ${license.id} with payment: ${payment.id}`);

        return {
            license,
            payment,
            checkoutUrl: payment.checkoutUrl,
        };
    }


    async updateLicense(userId, data, requestingUser = null) {
        const license = await prisma.license.findUnique({ where: { userId } });
        if (!license) throw new Error('License not found.');

        const updateData = {};
        if (data.companyName !== undefined) updateData.companyName = data.companyName;
        if (data.phoneNumber !== undefined) updateData.phoneNumber = data.phoneNumber;
        if (data.emailAddress !== undefined) updateData.emailAddress = data.emailAddress;
        if (data.certifiedEmail !== undefined) updateData.certifiedEmail = data.certifiedEmail;
        if (data.subdomain !== undefined) updateData.subdomain = data.subdomain;
        if (data.customDomain !== undefined) updateData.customDomain = data.customDomain;
        if (data.vatNumber !== undefined) updateData.vatNumber = data.vatNumber;
        if (data.vatPercentage !== undefined) updateData.vatPercentage = data.vatPercentage;
        if (data.autoRenew !== undefined) updateData.autoRenew = data.autoRenew;
        if (data.maxUsers !== undefined) updateData.maxUsers = data.maxUsers;
        if (data.maxCourses !== undefined) updateData.maxCourses = data.maxCourses;
        if (data.storageMb !== undefined) updateData.storageMb = data.storageMb;
        if (data.billingCycle !== undefined) updateData.billingCycle = data.billingCycle;

        if (data.planTier) {
            const plan = await prisma.licensePlan.findUnique({ where: { tier: data.planTier } });
            if (!plan) throw new Error(`Plan "${data.planTier}" not found.`);
            updateData.planId = plan.id;
            updateData.maxUsers = plan.maxUsers;
            updateData.maxCourses = plan.maxCourses;
            updateData.storageMb = plan.storageMb;
        }

        return prisma.license.update({
            where: { userId },
            data: updateData,
            include: {
                user: { select: { id: true, email: true, firstName: true, lastName: true } },
                plan: true,
            },
        });
    }
    async renewLicense(userId, data, requestingUser = null) {
        // Allow: platform admin OR the licensee themselves
        const isSelf = requestingUser?.id === userId;
        const isAdmin = requestingUser?.level === 'PLATFORM_ADMIN';
        if (!isSelf && !isAdmin) {
            throw new Error('You can only renew your own license.');
        }

        const { daysToAdd = 365, planTier, billingCycle = 'YEARLY', couponCode, paymentId } = data;

        const license = await prisma.license.findUnique({
            where: { userId },
            select: { id: true, expiresAt: true, planId: true, tenantId: true, vatPercentage: true, isSuspended: true },
        });
        if (!license) throw new Error('License not found.');
        if (license.isSuspended && !isAdmin) throw new Error('Your license is suspended. Contact support to renew.');

        let plan = null;
        if (planTier) {
            plan = await prisma.licensePlan.findUnique({ where: { tier: planTier } });
            if (!plan) throw new Error(`Plan "${planTier}" not found.`);
        } else if (license.planId) {
            plan = await prisma.licensePlan.findUnique({ where: { id: license.planId } });
        }
        if (!plan) throw new Error('No plan found for renewal.');

        const price = billingCycle === 'MONTHLY'
            ? plan.priceMonthly
            : (plan.priceAnnual || plan.priceYearly || plan.priceMonthly * 12);

        // If already expired, renew from today; otherwise extend from expiry
        const baseDate = license.expiresAt < new Date() ? new Date() : license.expiresAt;
        const newExpiresAt = addDays(baseDate, daysToAdd);

        let finalPaymentId = paymentId;
        if (!finalPaymentId) {
            const payment = await paymentService.createLicenseRenewalPayment({
                userId,
                licenseId: license.id,
                planId: plan.id,
                amount: price,
                billingCycle,
                couponCode,
                vatPercentage: license.vatPercentage || 22,
                tenantId: license.tenantId,
            });
            finalPaymentId = payment.id;
        }

        return prisma.$transaction(async (tx) => {
            const renewal = await tx.licenseRenewal.create({
                data: {
                    licenseId: license.id,
                    previousExpiresAt: license.expiresAt,
                    newExpiresAt,
                    planId: plan.id,
                    amount: price,
                    paymentId: finalPaymentId,
                },
                include: { plan: true },
            });

            const updated = await tx.license.update({
                where: { userId },
                data: {
                    expiresAt: newExpiresAt,
                    planId: plan.id,
                    maxUsers: plan.maxUsers,
                    maxCourses: plan.maxCourses,
                    storageMb: plan.storageMb,
                    priceAtPurchase: price,
                    billingCycle,
                    isSuspended: false, // auto-unsuspend on renewal if admin renews
                },
                include: {
                    user: { select: { id: true, email: true, firstName: true, lastName: true } },
                    plan: true,
                    payment: true,
                },
            });

            log.info(`License renewed: ${license.id} → expires ${newExpiresAt.toISOString()}`);
            return { license: updated, renewal, newExpiresAt, daysAdded: daysToAdd, plan };
        });
    }

    async createLicenseCheckout(data, requestingUser = null) {
        const {
            planId,
            billingCycle = 'YEARLY',
            couponCode,
            companyName,
            subdomain,
            customDomain,
            phoneNumber,
            emailAddress,
            certifiedEmail,
            vatNumber,
            vatPercentage,
        } = data;
        const plan = await prisma.licensePlan.findUnique({ where: { id: planId, isActive: true } });
        if (!plan) throw new Error('License plan not found or inactive.');

        const existingSubdomain = await prisma.tenant.findUnique({ where: { subdomain }, select: { id: true } });
        if (existingSubdomain) throw new Error('Subdomain is already taken.');
        const existingCustomDomain = await prisma.tenant.findUnique({ where: { customDomain }, select: { id: true } });
        if (existingCustomDomain) throw new Error('Custom domain is already in use.');

        const price = billingCycle === 'MONTHLY' ? plan.priceMonthly : (plan.priceAnnual || plan.priceYearly || plan.priceMonthly * 12);

        return paymentService.createLicenseCheckout({
            userId: requestingUser.id,
            planId: plan.id,
            planTier: plan.tier,
            amount: price,
            billingCycle,
            couponCode,
            companyName,
            subdomain,
            customDomain,
            phoneNumber: phoneNumber || null,
            emailAddress: emailAddress || requestingUser.email,
            certifiedEmail: certifiedEmail || null,
            vatNumber: vatNumber || null,
            vatPercentage: vatPercentage || 22,
            tenantId: requestingUser.tenantId,
        });
    }

    async createRenewalCheckout(data, requestingUser = null) {
        const { licenseId, planId, billingCycle = 'YEARLY', couponCode } = data;
        const license = await prisma.license.findUnique({ where: { id: licenseId }, include: { plan: true } });
        if (!license) throw new Error('License not found.');
        if (license.userId !== requestingUser.id && requestingUser.level !== 'PLATFORM_ADMIN') {
            throw new Error('You can only renew your own license.');
        }

        let plan = license.plan;
        if (planId) {
            plan = await prisma.licensePlan.findUnique({ where: { id: planId, isActive: true } });
            if (!plan) throw new Error('Plan not found or inactive.');
        }
        if (!plan) throw new Error('No plan found for renewal.');

        const price = billingCycle === 'MONTHLY' ? plan.priceMonthly : (plan.priceAnnual || plan.priceYearly || plan.priceMonthly * 12);

        return paymentService.createLicenseRenewalCheckout({
            userId: requestingUser.id,
            licenseId: license.id,
            planId: plan.id,
            amount: price,
            billingCycle,
            couponCode,
            vatPercentage: license.vatPercentage || 22,
            tenantId: license.tenantId,
            currentPlanTier: license.plan?.tier,
            newPlanTier: plan.tier,
        });
    }

    async getLicenseByUser(userId, requestingUser = null) {
        if (requestingUser?.level !== 'PLATFORM_ADMIN' && requestingUser?.id !== userId) {
            throw new Error('You can only view your own license.');
        }
        const license = await prisma.license.findUnique({
            where: { userId },
            include: {
                user: { select: { id: true, email: true, firstName: true, lastName: true, level: true } },
                plan: true,
                tenant: { include: { _count: { select: { courses: true, users: true } } } },
                earnings: { orderBy: { createdAt: 'desc' }, take: 10 },
                renewals: { orderBy: { createdAt: 'desc' }, take: 5, include: { plan: true, payment: { select: { id: true, amount: true, status: true, createdAt: true } } } },
                payment: { include: { invoice: true } },
            },
        });
        if (!license) return null;

        return {
            ...license,
            usage: {
                coursesUsed: license.tenant?._count?.courses ?? 0,
                usersUsed: license.tenant?._count?.users ?? 0,
                coursesRemaining: license.maxCourses - (license.tenant?._count?.courses ?? 0),
                usersRemaining: license.maxUsers - (license.tenant?._count?.users ?? 0),
                daysRemaining: differenceInDays(license.expiresAt, new Date()),
                isExpired: license.expiresAt < new Date(),
            },
            paymentHistory: {
                originalPurchase: license.payment,
                renewals: license.renewals.map(r => ({ ...r, payment: r.payment })),
            },
        };
    }

    async getAllLicenses(queryParams = {}, requestingUser = null) {
        if (requestingUser?.level !== 'PLATFORM_ADMIN') throw new Error('Only Platform Admin can list all licenses.');
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;
        const where = {};
        if (queryParams.isSuspended !== undefined) where.isSuspended = queryParams.isSuspended === 'true';
        if (queryParams.tenantId) where.tenantId = queryParams.tenantId;
        if (queryParams.userId) where.userId = queryParams.userId;
        if (queryParams.planTier) where.plan = { tier: queryParams.planTier };
        if (queryParams.search) {
            where.OR = [
                { companyName: { contains: queryParams.search, mode: 'insensitive' } },
                { subdomain: { contains: queryParams.search, mode: 'insensitive' } },
                { customDomain: { contains: queryParams.search, mode: 'insensitive' } },
                { user: { email: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { firstName: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { lastName: { contains: queryParams.search, mode: 'insensitive' } } },
            ];
        }
        const orderBy = { [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' };
        const [licenses, total] = await Promise.all([
            prisma.license.findMany({ where, orderBy, skip, take: limit, include: { user: { select: { id: true, email: true, firstName: true, lastName: true, level: true } }, plan: true, tenant: { select: { id: true, name: true, subdomain: true, customDomain: true } }, payment: { select: { id: true, amount: true, status: true, createdAt: true, invoice: { select: { id: true, status: true, pdfUrl: true } } } }, _count: { select: { earnings: true, renewals: true } } } }),
            prisma.license.count({ where }),
        ]);
        return { meta: { page, limit, total, totalPages: Math.ceil(total / limit) }, licenses };
    }

    async toggleLicenseSuspension(userId, isSuspended, requestingUser = null) {
        if (requestingUser?.level !== 'PLATFORM_ADMIN') throw new Error('Only Platform Admin can suspend licenses.');
        const license = await prisma.license.findUnique({ where: { userId }, select: { id: true, tenantId: true } });
        if (!license) throw new Error('License not found.');
        return prisma.$transaction(async (tx) => {
            const updated = await tx.license.update({ where: { userId }, data: { isSuspended }, include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } } });
            if (license.tenantId) await tx.tenant.update({ where: { id: license.tenantId }, data: { isActive: !isSuspended } });
            return updated;
        });
    }

    async getLicenseStats(userId, requestingUser = null) {
        if (requestingUser?.level !== 'PLATFORM_ADMIN' && requestingUser?.id !== userId) throw new Error('You can only view your own license stats.');
        const license = await prisma.license.findUnique({ where: { userId }, include: { plan: true, earnings: { select: { grossAmount: true, platformFeeAmount: true, licenseeAmount: true, settledAt: true, createdAt: true } }, renewals: { select: { amount: true, createdAt: true, plan: true } }, tenant: { include: { _count: { select: { courses: true, users: true, payments: true } } } }, payment: { select: { id: true, amount: true, status: true, createdAt: true } } } });
        if (!license) throw new Error('License not found.');
        const totalEarnings = license.earnings.reduce((s, e) => s + e.licenseeAmount, 0);
        const settledEarnings = license.earnings.filter(e => e.settledAt).reduce((s, e) => s + e.licenseeAmount, 0);
        return { userId: license.userId, companyName: license.companyName, subdomain: license.subdomain, customDomain: license.customDomain, isSuspended: license.isSuspended, billingCycle: license.billingCycle, startsAt: license.startsAt, expiresAt: license.expiresAt, daysRemaining: differenceInDays(license.expiresAt, new Date()), isExpired: license.expiresAt < new Date(), plan: license.plan, maxCourses: license.maxCourses, maxUsers: license.maxUsers, storageMb: license.storageMb, usage: { coursesUsed: license.tenant?._count?.courses ?? 0, usersUsed: license.tenant?._count?.users ?? 0, payments: license.tenant?._count?.payments ?? 0 }, financial: { totalEarnings, settledEarnings, pendingEarnings: totalEarnings - settledEarnings, totalRenewals: license.renewals.length, totalRenewalAmount: license.renewals.reduce((s, r) => s + r.amount, 0), lastPayment: license.payment } };
    }

    async deleteLicense(userId, requestingUser = null) {
        if (requestingUser?.level !== 'PLATFORM_ADMIN') throw new Error('Only Platform Admin can delete licenses.');
        const license = await prisma.license.findUnique({ where: { userId }, select: { id: true, tenantId: true, _count: { select: { earnings: true, renewals: true } } } });
        if (!license) throw new Error('License not found.');
        if (license._count.earnings > 0 || license._count.renewals > 0) throw new Error('Cannot delete a license with earnings or renewals. Suspend it instead.');
        await prisma.$transaction(async (tx) => {
            await tx.license.delete({ where: { userId } });
            await tx.user.update({ where: { id: userId }, data: { tenantId: null } });
            if (license.tenantId) {
                const tenant = await tx.tenant.findUnique({ where: { id: license.tenantId }, include: { _count: { select: { users: true } } } });
                if (tenant && tenant._count.users === 0) await tx.tenant.delete({ where: { id: license.tenantId } });
            }
        });
        return { success: true, message: 'License deleted successfully.' };
    }

    async getPlans(locale = 'it') {
        const plans = await prisma.licensePlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
        return plans.map(p => ({ ...p, label: p.name?.[locale] ?? p.name?.it ?? p.tier }));
    }
    // Add this method to LicenseService class

    async getMyLicenses(userId, queryParams = {}, requestingUser = null) {
        if (requestingUser?.level !== 'PLATFORM_ADMIN' && requestingUser?.id !== userId) {
            throw new Error('You can only view your own license.');
        }

        const license = await prisma.license.findUnique({
            where: { userId },
            include: {
                user: { select: { id: true, email: true, firstName: true, lastName: true, level: true } },
                plan: true,
                tenant: { include: { _count: { select: { courses: true, users: true } } } },
                earnings: { orderBy: { createdAt: 'desc' }, take: 10 },
                renewals: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    include: {
                        plan: true,
                        payment: { select: { id: true, amount: true, status: true, createdAt: true } }
                    }
                },
                payment: { include: { invoice: true } },
            },
        });

        if (!license) return { license: null, statusFilter: queryParams.statusFilter ?? null };

        const now = new Date();
        const daysRemaining = differenceInDays(license.expiresAt, now);
        const isExpired = license.expiresAt < now;
        const isExpiring = !isExpired && daysRemaining <= 30; // within 30 days
        const isActive = !isExpired && !isExpiring;

        // Compute the status string
        const computedStatus = isExpired ? 'EXPIRED' : isExpiring ? 'EXPIRING' : 'ACTIVE';

        // Apply status filter if provided
        const { statusFilter } = queryParams; // 'ACTIVE' | 'EXPIRING' | 'EXPIRED'
        if (statusFilter && computedStatus !== statusFilter.toUpperCase()) {
            return { license: null, status: computedStatus, filtered: true };
        }

        return {
            license: {
                ...license,
                computedStatus,
                usage: {
                    coursesUsed: license.tenant?._count?.courses ?? 0,
                    usersUsed: license.tenant?._count?.users ?? 0,
                    coursesRemaining: license.maxCourses - (license.tenant?._count?.courses ?? 0),
                    usersRemaining: license.maxUsers - (license.tenant?._count?.users ?? 0),
                    daysRemaining,
                    isExpired,
                    isExpiring,
                    isActive,
                },
                paymentHistory: {
                    originalPurchase: license.payment,
                    renewals: license.renewals.map(r => ({ ...r, payment: r.payment })),
                },
            },
            status: computedStatus,
        };
    }
    _generateTempPassword() { return Math.random().toString(36).slice(-10) + 'A1!'; }
}

export const licenseService = new LicenseService();