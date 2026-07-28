import { prisma } from '../../config/db.js';
import { localizeObject, localizeArrayField } from '../../shared/services/translate/translate.service.js';

const LICENSE_PLAN_I18N_KEYS = ['name', 'description', 'supportLevel'];
const LICENSE_PLAN_I18N_ARRAY_KEYS = ['features'];

export class LicensePlanService {
    /**
     * Get all license plans with features
     */
    async getAllLicensePlans(queryParams = {}, locale = 'it', user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};

        if (queryParams.isActive !== undefined) {
            where.isActive = queryParams.isActive === 'true';
        }

        if (queryParams.tier) {
            where.tier = queryParams.tier;
        }

        const orderBy = {
            [queryParams.sortBy || 'sortOrder']: queryParams.sortOrder === 'desc' ? 'desc' : 'asc',
        };

        const [plans, total] = await Promise.all([
            prisma.licensePlan.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    _count: {
                        select: { licenses: true },
                    },
                },
            }),
            prisma.licensePlan.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            plans: plans.map((plan) => this._formatPlanForResponse(plan, locale)),
        };
    }

    /**
     * Get public plans for pricing page
     */
    async getPublicPlans(locale = 'it', includeInactive = false) {
        const where = includeInactive ? {} : { isActive: true };

        const plans = await prisma.licensePlan.findMany({
            where,
            orderBy: { sortOrder: 'asc' },
            include: {
                _count: {
                    select: { licenses: true },
                },
            },
        });

        return plans.map((plan) => this._formatPlanForResponse(plan, locale));
    }

    /**
     * Get single plan by ID with full details
     */
    async getPlanById(planId, locale = 'it') {
        const plan = await prisma.licensePlan.findUnique({
            where: { id: planId },
            include: {
                _count: {
                    select: { licenses: true },
                },
            },
        });

        if (!plan) throw new Error('License plan not found');

        return this._formatPlanForResponse(plan, locale);
    }

    /**
     * Get plan by tier
     */
    async getPlanByTier(tier, locale = 'it') {
        const plan = await prisma.licensePlan.findUnique({
            where: { tier },
            include: {
                _count: {
                    select: { licenses: true },
                },
            },
        });

        if (!plan) throw new Error('License plan not found');

        return this._formatPlanForResponse(plan, locale);
    }

    /**
     * Create license plan with multi-language features
     */
    async createLicensePlan(data, userId) {
        const { tier, name, description, features, supportLevel, ...rest } = data;

        const existing = await prisma.licensePlan.findUnique({
            where: { tier },
            select: { id: true },
        });
        if (existing) {
            throw new Error(`License plan with tier "${tier}" already exists`);
        }

        return prisma.licensePlan.create({
            data: {
                tier,
                name,
                description: description || null,
                features: features || null,
                supportLevel: supportLevel || null,
                ...rest,
            },
            include: {
                _count: {
                    select: { licenses: true },
                },
            },
        });
    }

    /**
     * Update license plan
     */
    async updateLicensePlan(id, data, userId) {
        const existing = await prisma.licensePlan.findUnique({
            where: { id },
            select: { id: true, tier: true },
        });
        if (!existing) throw new Error('License plan not found');

        const { name, description, features, supportLevel, ...rest } = data;

        return prisma.licensePlan.update({
            where: { id },
            data: {
                ...rest,
                ...(name && { name }),
                ...(description !== undefined && { description }),
                ...(features !== undefined && { features }),
                ...(supportLevel !== undefined && { supportLevel }),
            },
            include: {
                _count: {
                    select: { licenses: true },
                },
            },
        });
    }

    /**
     * Delete license plan
     */
    async deleteLicensePlan(id, userId) {
        const existing = await prisma.licensePlan.findUnique({
            where: { id },
            select: {
                id: true,
                tier: true,
                _count: {
                    select: { licenses: true },
                },
            },
        });
        if (!existing) throw new Error('License plan not found');

        if (existing._count.licenses > 0) {
            throw new Error(
                `Cannot delete license plan with ${existing._count.licenses} license(s). Deactivate it instead.`
            );
        }

        return prisma.licensePlan.delete({
            where: { id },
            select: {
                id: true,
                tier: true,
                name: true,
            },
        });
    }

    /**
     * Toggle active status
     */
    async toggleActive(id, isActive, userId) {
        const existing = await prisma.licensePlan.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new Error('License plan not found');

        return prisma.licensePlan.update({
            where: { id },
            data: { isActive },
            select: {
                id: true,
                tier: true,
                name: true,
                isActive: true,
            },
        });
    }

    /**
     * Format plan for API response with localization
     */
    _formatPlanForResponse(plan, locale = 'it') {
        // Localize string fields
        const localized = localizeObject(plan, locale, LICENSE_PLAN_I18N_KEYS);

        // Localize array fields (features)
        let localizedFeatures = null;
        if (plan.features) {
            localizedFeatures = localizeArrayField(plan.features, locale);
        }

        // Determine display price
        const displayPrice = plan.priceAnnual || plan.priceYearly || plan.priceMonthly;

        // Check if unlimited
        const isUnlimitedUsers = plan.maxUsers >= 999999;
        const isUnlimitedStorage = plan.storageMb >= 999999;
        const isUnlimitedCourses = plan.maxCourses >= 999999;

        // Format storage
        const formatStorage = (mb) => {
            if (isUnlimitedStorage) return null;
            if (mb >= 1024) return `${Math.round(mb / 1024)} GB`;
            return `${mb} MB`;
        };

        return {
            id: localized.id,
            tier: localized.tier,
            name: localized.name,
            description: localized.description,
            features: localizedFeatures,
            supportLevel: localized.supportLevel,

            // Limits
            maxUsers: isUnlimitedUsers ? null : localized.maxUsers,
            isUnlimitedUsers,
            storageMb: isUnlimitedStorage ? null : localized.storageMb,
            storageDisplay: formatStorage(localized.storageMb),
            isUnlimitedStorage,
            maxCourses: isUnlimitedCourses ? null : localized.maxCourses,
            isUnlimitedCourses,

            // Pricing
            priceMonthly: localized.priceMonthly,
            priceYearly: localized.priceYearly,
            priceAnnual: localized.priceAnnual,
            displayPrice,
            currency: 'EUR',

            // Meta
            isActive: localized.isActive,
            sortOrder: localized.sortOrder,
            totalLicenses: localized._count?.licenses || 0,
        };
    }
}

export const licensePlanService = new LicensePlanService();