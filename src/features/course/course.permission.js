/**
 * Course access rules (client requirement):
 *
 * PLATFORM_ADMIN (Livello 1 — platform operator)
 *   - Can create courses for any tenant (must pass tenantId)
 *   - Can add / update / delete / reorder lessons on courses THEY created
 *   - Can view stats for their own courses
 *
 * LICENSE_USER (Livello 3 — licensee / tenant owner)
 *   - Can create courses only inside their own tenant
 *   - Can manage lessons on courses THEY created
 *   - Can monitor students enrolled in their courses (enrollment module)
 *
 * Both roles use the same lesson CRUD guard: authorize('PLATFORM_ADMIN', 'LICENSE_USER')
 * Ownership is always checked via createdById — neither role can manage another user's course.
 *
 * Students (PRIVATE_USER, COMPANY_EMPLOYEE, etc.) access lessons via enrollment.
 * Managers who are enrolled in someone else's course are treated as students for progress APIs.
 */

export const isCourseOwner = (course, userId) =>
    Boolean(course?.createdById && userId && course.createdById === userId);

export const isCourseManager = (user) =>
    user?.level === 'LICENSE_USER' || user?.level === 'PLATFORM_ADMIN';

export const assertCourseOwner = (course, user, action = 'manage') => {
    if (!user?.id) throw new Error('Authentication required');
    if (!isCourseOwner(course, user.id)) {
        throw new Error(`Permission denied: only the course creator can ${action} this course`);
    }
};

/** Lesson/course CRUD — PLATFORM_ADMIN and LICENSE_USER, creator only */
export const assertCanManageCourse = (course, user, action = 'manage') => {
    if (!user?.id) throw new Error('Authentication required');
    if (!isCourseManager(user)) {
        throw new Error(
            `Permission denied: only Platform Admin or License User can ${action} this course`
        );
    }
    assertCourseOwner(course, user, action);
};

/**
 * Read / progress APIs — owners, teachers, enrolled students, or anyone if course is active.
 * Managers who did NOT create the course follow student rules (can enroll and track progress).
 */
export const assertCanAccessCourse = async (course, user, prisma) => {
    if (!user?.id) return;

    if (isCourseManager(user) && isCourseOwner(course, user.id)) return;

    if (user.level === 'TEACHER') {
        const teacherCourse = await prisma.course.findFirst({
            where: {
                id: course.id,
                OR: [{ createdById: user.id }, { teacherId: user.id }],
            },
            select: { id: true },
        });
        if (!teacherCourse) {
            throw new Error('Permission denied: You are not the teacher of this course');
        }
        return;
    }

    if (!course.isActive) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId: user.id, courseId: course.id } },
            select: { id: true },
        });
        if (!enrollment) throw new Error('This course is not active');
    }
};

/** Prisma where fragment — courses owned by this user */
export const ownedCoursesWhere = (userId) => ({ createdById: userId });
