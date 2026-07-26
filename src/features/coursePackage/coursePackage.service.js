import { randomUUID } from 'crypto';
import { prisma } from '../../config/db.js';
import { translateAll } from '../../shared/services/translate/translate.service.js';

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];

async function expandI18n(value) {
    if (!value) return value;
    if (typeof value === 'string') return translateAll(value);

    const hasAllLocales = SUPPORTED_LOCALES.every((locale) => value[locale]?.trim());
    if (hasAllLocales) return value;

    const source =
        value.it?.trim() ||
        value.en?.trim() ||
        Object.values(value).find((entry) => typeof entry === 'string' && entry.trim());

    if (!source) return value;

    const translated = await translateAll(source);
    return { ...translated, ...value };
}

async function expandFeature(feature) {
    if (!feature || typeof feature !== 'object') return feature;

    if (feature.type === 'pricing' || feature.type === 'feature') {
        return {
            ...feature,
            ...(feature.label ? { label: await expandI18n(feature.label) } : {}),
        };
    }

    return expandI18n(feature);
}

async function localizePackageData(data) {
    const result = { ...data };

    if (result.title) result.title = await expandI18n(result.title);
    if (result.description) result.description = await expandI18n(result.description);

    if (Array.isArray(result.features)) {
        result.features = await Promise.all(result.features.map(expandFeature));
    }

    return result;
}

const normalizeLevel = (level) =>
    String(level || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');

async function resolveEffectiveTenantId(user) {
    if (!user) return null;
    if (user.tenantId) return user.tenantId;
    if (!user.id) return null;

    const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { tenantId: true },
    });

    return dbUser?.tenantId ?? null;
}

export class CoursePackageService {

    async getAll(queryParams = {}, user = null) {
        const where = {};
        if (queryParams.type) where.type = queryParams.type;
        if (queryParams.isActive !== undefined) where.isActive = queryParams.isActive;

        const userLevel = normalizeLevel(user?.level ?? user?.role);

        if (userLevel === 'LICENSE_USER') {
            const tenantId = await resolveEffectiveTenantId(user);
            if (!tenantId) {
                throw new Error('Licensee user has no tenant assigned. Contact admin.');
            }
            where.OR = [{ tenantId: null }, { tenantId }];
        } else if (queryParams.tenantId) {
            where.tenantId = queryParams.tenantId;
        }

        return prisma.coursePackage.findMany({ where, orderBy: { createdAt: 'desc' } });
    }


    async listForSelection(type, user = null) {
        const tenantId = user ? await resolveEffectiveTenantId(user) : null;

        return prisma.coursePackage.findMany({
            where: {
                type,
                isActive: true,
                OR: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])],
            },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });
    }

    async getById(id) {
        const pkg = await prisma.coursePackage.findUnique({ where: { id } });
        if (!pkg) throw new Error('Course package not found');
        return pkg;
    }

    _normalizeFeatures(features = []) {
        return features.map(f => ({
            ...f,
            id: f.id || randomUUID(),
        }));
    }

    async create(data, user) {
        const userLevel = normalizeLevel(user?.level ?? user?.role);

        if (!['PLATFORM_ADMIN', 'LICENSE_USER'].includes(userLevel)) {
            throw new Error('Only Platform Admin and Licensee users can create course packages');
        }

        let tenantId = data.tenantId ?? null;

        if (userLevel === 'LICENSE_USER') {
            tenantId = await resolveEffectiveTenantId(user);
            if (!tenantId) {
                throw new Error('Licensee user has no tenant assigned. Contact admin.');
            }
        }

        const localized = await localizePackageData(data);

        return prisma.coursePackage.create({
            data: {
                ...localized,
                tenantId,
                features: localized.features ? this._normalizeFeatures(localized.features) : localized.features,
            },
        });
    }

    async update(id, data, user) {
        const existing = await this.getById(id);
        const effectiveTenantId = await resolveEffectiveTenantId(user);
        this._checkPermission(existing, user, effectiveTenantId);

        const userLevel = normalizeLevel(user?.level ?? user?.role);
        const { tenantId, features, ...rest } = data;
        const localized = await localizePackageData({ ...rest, ...(features !== undefined && { features }) });

        return prisma.coursePackage.update({
            where: { id },
            data: {
                ...localized,
                ...(features !== undefined && { features: this._normalizeFeatures(localized.features || []) }),
                ...(tenantId !== undefined && userLevel === 'PLATFORM_ADMIN' && { tenantId }),
            },
        });
    }

    async delete(id, user) {
        const existing = await this.getById(id);
        const effectiveTenantId = await resolveEffectiveTenantId(user);
        this._checkPermission(existing, user, effectiveTenantId);

        const inUse = await prisma.course.count({
            where: { OR: [{ singleUserPackageId: id }, { companyPackageId: id }] },
        });
        if (inUse > 0) {
            throw new Error(`Cannot delete: ${inUse} course(s) reference this package. Deactivate it instead.`);
        }

        return prisma.coursePackage.delete({ where: { id } });
    }

    _checkPermission(pkg, user, effectiveTenantId) {
        const userLevel = normalizeLevel(user?.level ?? user?.role);

        if (userLevel === 'PLATFORM_ADMIN') return;

        if (userLevel === 'LICENSE_USER') {
            if (!pkg.tenantId) return;
            if (pkg.tenantId === effectiveTenantId) return;
            throw new Error('Permission denied: questo pacchetto appartiene a un altro tenant');
        }

        throw new Error('Permission denied');
    }
}

export const coursePackageService = new CoursePackageService();
