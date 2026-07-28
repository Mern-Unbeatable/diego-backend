import { randomUUID } from 'crypto'; // ✅ FIX: এই import টাই মিসিং ছিল
import { prisma } from '../../config/db.js';

export class CoursePackageService {

    async getAll(queryParams = {}) {
        const where = {};
        if (queryParams.type) where.type = queryParams.type;
        if (queryParams.isActive !== undefined) where.isActive = queryParams.isActive;
        if (queryParams.tenantId) where.tenantId = queryParams.tenantId;

        return prisma.coursePackage.findMany({ where, orderBy: { createdAt: 'desc' } });
    }

    // dropdown এর জন্য — course create/edit form এ ব্যবহার হবে
    async listForSelection(type, tenantId = null) {
        return prisma.coursePackage.findMany({
            where: {
                type,
                isActive: true,
                OR: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])],
            },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
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
            id: f.id || randomUUID(), // এখন কাজ করবে, কারণ import যোগ করা হয়েছে
        }));
    }

    async create(data, userLevel, userTenantId) {
        if (!['PLATFORM_ADMIN', 'LICENSE_USER'].includes(userLevel)) {
            throw new Error('Only Platform Admin and Licensee users can create course packages');
        }

        let tenantId = data.tenantId ?? null;
        if (userLevel === 'LICENSE_USER') tenantId = userTenantId;

        return prisma.coursePackage.create({
            data: {
                ...data,
                tenantId,
                features: data.features ? this._normalizeFeatures(data.features) : data.features,
            },
        });
    }

    async update(id, data, userLevel, userTenantId) {
        const existing = await this.getById(id);
        this._checkPermission(existing, userLevel, userTenantId);

        const { tenantId, features, ...rest } = data;
        return prisma.coursePackage.update({
            where: { id },
            data: {
                ...rest,
                ...(features !== undefined && { features: this._normalizeFeatures(features) }),
                ...(tenantId !== undefined && userLevel === 'PLATFORM_ADMIN' && { tenantId }),
            },
        });
    }

    async delete(id, userLevel, userTenantId) {
        const existing = await this.getById(id);
        this._checkPermission(existing, userLevel, userTenantId);

        const inUse = await prisma.course.count({
            where: { OR: [{ singleUserPackageId: id }, { companyPackageId: id }] },
        });
        if (inUse > 0) {
            throw new Error(`Cannot delete: ${inUse} course(s) reference this package. Deactivate it instead.`);
        }

        return prisma.coursePackage.delete({ where: { id } });
    }

    _checkPermission(pkg, userLevel, userTenantId) {
        if (userLevel === 'PLATFORM_ADMIN') return;
        if (userLevel === 'LICENSE_USER' && pkg.tenantId === userTenantId) return;
        throw new Error('Permission denied');
    }
}

export const coursePackageService = new CoursePackageService();