
import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { userSafeSelect } from '../auth/auth.utils.js';

const COURSE_I18N_KEYS = ['courseTitle', 'description'];
const PACKAGE_I18N_KEYS = ['name', 'description'];
const QUIZ_I18N_KEYS = ['quizTitle'];

class UserService {

  async createUser(data) {
    return prisma.user.create({ data, select: userSafeSelect });
  }

  async getUserById(id) {
    return prisma.user.findUnique({ where: { id }, select: userSafeSelect });
  }

  async getUserByIdWithPassword(id) {
    return prisma.user.findUnique({ where: { id } });
  }

  async getUserByEmail(email) {
    return prisma.user.findUnique({ where: { email }, select: userSafeSelect });
  }

  async getUserByEmailWithPassword(email) {
    return prisma.user.findUnique({ where: { email } });
  }

  // ===== GET FULL PROFILE WITH AVATAR =====
  async getFullProfile(id, locale = 'it') {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...userSafeSelect,
        avatar: true, // ✅ Using 'avatar' field name
        company: {
          select: {
            id: true,
            name: true,
            fiscalAddress: true,
            vatNumber: true,
            fiscalCode: true,
            pec: true,
            uniqueCode: true,
            logoUrl: true,
          },
        },
        enrollments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            expiresAt: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            course: {
              select: {
                id: true,
                courseTitle: true,
                slug: true,
                description: true,
                thumbnailUrl: true,
                format: true,
                price: true,
              },
            },
            certificate: {
              select: {
                id: true,
                status: true,
                downloadableUntil: true,
                pdfUrl: true,
              },
            },
          },
        },
        license: {
          select: {
            id: true,
            companyName: true,
            subdomain: true,
            customDomain: true,
            planId: true,
            plan: {
              select: {
                id: true,
                tier: true,
                name: true,
                maxUsers: true,
                maxCourses: true,
                storageMb: true,
                priceMonthly: true,
              },
            },
            expiresAt: true,
            isSuspended: true,
            maxCourses: true,
            maxUsers: true,
            storageMb: true,
            startsAt: true,
            autoRenew: true,
          },
        },
        archiveSubscription: {
          select: {
            isActive: true,
            expiresAt: true,
            storageMb: true,
            startedAt: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
            certificates: true,
            payments: true,
          },
        },
      },
    });

    if (!user) return null;

    const localizedEnrollments = user.enrollments.map((enrollment) => ({
      ...enrollment,
      course: localizeObject(enrollment.course, locale, COURSE_I18N_KEYS),
    }));

    let localizedLicense = user.license;
    if (user.license?.plan?.name) {
      localizedLicense = {
        ...user.license,
        plan: {
          ...user.license.plan,
          name: localizeObject(user.license.plan, locale, ['name']),
        },
      };
    }

    return {
      ...user,
      enrollments: localizedEnrollments,
      license: localizedLicense,
    };
  }

  // ===== UPDATE PROFILE WITH AVATAR =====
  async updateProfile(id, data) {
    const allowed = {};

    // Personal info
    if (data.firstName !== undefined) allowed.firstName = data.firstName;
    if (data.lastName !== undefined) allowed.lastName = data.lastName;
    if (data.residenceAddress !== undefined) allowed.residenceAddress = data.residenceAddress;
    if (data.city !== undefined) allowed.city = data.city;
    if (data.country !== undefined) allowed.country = data.country;
    if (data.traineeTaxCode !== undefined) allowed.traineeTaxCode = data.traineeTaxCode;

    // Company info
    if (data.companyName !== undefined) allowed.companyName = data.companyName;
    if (data.companyAddress !== undefined) allowed.companyAddress = data.companyAddress;
    if (data.companyTaxCode !== undefined) allowed.companyTaxCode = data.companyTaxCode;
    if (data.companyVatNumber !== undefined) allowed.companyVatNumber = data.companyVatNumber;
    if (data.companyPosition !== undefined) allowed.companyPosition = data.companyPosition;

    // Other info
    if (data.serviceType !== undefined) allowed.serviceType = data.serviceType;
    if (data.contactNumber !== undefined) allowed.contactNumber = data.contactNumber;
    if (data.preferredLanguage !== undefined) allowed.preferredLanguage = data.preferredLanguage;
    if (data.citizenship !== undefined) allowed.citizenship = data.citizenship;

    // ✅ Avatar field (matches Prisma schema)
    if (data.avatar !== undefined) {
      allowed.avatar = data.avatar;
    }

    if (Object.keys(allowed).length === 0) throw new Error('No valid fields to update');
    if (allowed.firstName || allowed.lastName) allowed.profileCompleted = true;

    return prisma.user.update({
      where: { id },
      data: allowed,
      select: {
        ...userSafeSelect,
        avatar: true, // Include avatar in response
      },
    });
  }


  // ===== UPDATE AVATAR ONLY - FIXED =====
  async updateAvatar(id, data) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, avatar: true }
    });
    if (!user) throw new Error('User not found');

    return prisma.user.update({
      where: { id },
      data: {
        avatar: data.avatar,
      },
      select: {
        ...userSafeSelect,
        avatar: true,
      },
    });
  }

  async getUserStats(id) {
    const [user, enrollmentsByStatus, certificatesCount, nextExpiry] = await Promise.all([
      prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          level: true,
          createdAt: true,
          consentGiven: true,
          companyId: true,
          isActive: true,
          status: true,
          avatar: true, // ✅ Using 'avatar'
        },
      }),
      prisma.enrollment.groupBy({
        by: ['status'],
        where: { userId: id },
        _count: { _all: true },
      }),
      prisma.certificate.count({
        where: { userId: id },
      }),
      prisma.enrollment.findFirst({
        where: {
          userId: id,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
        },
        orderBy: { expiresAt: 'asc' },
        select: {
          expiresAt: true,
          course: {
            select: {
              courseTitle: true,
            },
          },
        },
      }),
    ]);

    if (!user) throw new Error('User not found');

    return {
      level: user.level,
      memberSince: user.createdAt,
      consentGiven: user.consentGiven,
      hasCompany: !!user.companyId,
      isActive: user.isActive,
      status: user.status,
      avatar: user.avatar, // ✅ Using 'avatar'
      enrollmentsByStatus: enrollmentsByStatus.reduce((acc, row) => {
        acc[row.status] = row._count._all;
        return acc;
      }, {}),
      totalCertificates: certificatesCount,
      nextExpiringCourse: nextExpiry
        ? {
          courseTitle: nextExpiry.course.courseTitle,
          expiresAt: nextExpiry.expiresAt,
        }
        : null,
    };
  }

  async getAllUsers(queryParams = {}) {
    const page = parseInt(queryParams.page) || 1;
    const limit = Math.min(parseInt(queryParams.limit) || 10, 50);
    const skip = (page - 1) * limit;

    let where = {};
    if (queryParams.level) where.level = queryParams.level;
    if (queryParams.status) where.status = queryParams.status;
    if (queryParams.isActive !== undefined) {
      where.isActive = queryParams.isActive === 'true';
    }

    if (queryParams.search) {
      where = {
        ...where,
        OR: [
          { email: { contains: queryParams.search, mode: 'insensitive' } },
          { firstName: { contains: queryParams.search, mode: 'insensitive' } },
          { lastName: { contains: queryParams.search, mode: 'insensitive' } },
          { company: { name: { contains: queryParams.search, mode: 'insensitive' } } },
        ],
      };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          ...userSafeSelect,
          avatar: true, // ✅ Using 'avatar'
          company: {
            select: {
              id: true,
              name: true,
              vatNumber: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              subdomain: true,
            },
          },
          _count: {
            select: {
              enrollments: true,
              certificates: true,
            },
          },
        },
        orderBy: {
          [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
      users,
    };
  }

  async getUserWithDetails(id, locale = 'it') {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...userSafeSelect,
        avatar: true, // ✅ Using 'avatar'
        company: {
          select: {
            id: true,
            name: true,
            fiscalAddress: true,
            vatNumber: true,
            fiscalCode: true,
            pec: true,
            uniqueCode: true,
            logoUrl: true,
          },
        },
        tenant: {
          select: {
            id: true,
            name: true,
            subdomain: true,
            customDomain: true,
          },
        },
        enrollments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            expiresAt: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            course: {
              select: {
                id: true,
                courseTitle: true,
                slug: true,
                description: true,
                thumbnailUrl: true,
                format: true,
                price: true,
              },
            },
            certificate: {
              select: {
                id: true,
                status: true,
                issuedAt: true,
                pdfUrl: true,
              },
            },
          },
        },
        certificates: {
          orderBy: { issuedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            issuedAt: true,
            downloadableUntil: true,
            pdfUrl: true,
            qrCode: true,
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            amount: true,
            type: true,
            status: true,
            createdAt: true,
          },
        },
        license: {
          select: {
            id: true,
            companyName: true,
            subdomain: true,
            customDomain: true,
            plan: {
              select: {
                id: true,
                tier: true,
                name: true,
                maxUsers: true,
                maxCourses: true,
                storageMb: true,
              },
            },
            expiresAt: true,
            isSuspended: true,
            maxCourses: true,
            maxUsers: true,
            storageMb: true,
            startsAt: true,
            autoRenew: true,
          },
        },
        archiveSubscription: {
          select: {
            id: true,
            isActive: true,
            expiresAt: true,
            storageMb: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
            certificates: true,
            payments: true,
          },
        },
      },
    });

    if (!user) return null;
    const localizedEnrollments = user.enrollments.map((e) => ({
      ...e,
      course: localizeObject(e.course, locale, COURSE_I18N_KEYS),
    }));

    return {
      ...user,
      enrollments: localizedEnrollments,
    };
  }

  async setVerified(id, isVerified) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new Error('User not found');

    return prisma.user.update({
      where: { id },
      data: {
        isVerified,
        ...(isVerified && { status: 'ACTIVE', isActive: true, verifiedAt: new Date() }),
      },
      select: {
        id: true,
        email: true,
        isVerified: true,
        status: true,
        level: true,
        isActive: true,
        avatar: true, // ✅ Using 'avatar'
      },
    });
  }

  async setStatus(id, status) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new Error('User not found');

    return prisma.user.update({
      where: { id },
      data: {
        status,
        isActive: status === 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        status: true,
        isActive: true,
        level: true,
        avatar: true, // ✅ Using 'avatar'
      },
    });
  }

  async deleteUser(id) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) throw new Error('User not found');

    return prisma.user.delete({ where: { id } });
  }

  async updateLastLogin(id) {
    return prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
      select: {
        ...userSafeSelect,
        avatar: true,
      },
    });
  }
}

export const userService = new UserService();