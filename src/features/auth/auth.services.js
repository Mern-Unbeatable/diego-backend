import bcrypt from 'bcryptjs';
import { prisma } from '../../config/db.js';
import { userSafeSelect } from './auth.utils.js';





class AuthService {
  generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async saveOtp(userId, otp, purpose) {
    const hashedOtp = await bcrypt.hash(otp, 10);
    return prisma.user.update({
      where: { id: userId },
      data: {
        otpCode: hashedOtp,
        otpExpires: new Date(Date.now() + 10 * 60 * 1000),
        otpPurpose: purpose,
      },
    });
  }

  async verifyOtp(userId, plainOtp) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, otpCode: true, otpExpires: true, otpPurpose: true },
    });

    if (!user?.otpCode) return { valid: false, reason: 'No OTP found' };
    if (user.otpExpires < new Date()) return { valid: false, reason: 'OTP expired' };

    const isMatch = await bcrypt.compare(plainOtp, user.otpCode);
    if (!isMatch) return { valid: false, reason: 'Invalid OTP' };

    return { valid: true, purpose: user.otpPurpose };
  }

  async clearOtp(userId) {
    return prisma.user.update({
      where: { id: userId },
      data: { otpCode: null, otpExpires: null, otpPurpose: null },
    });
  }

  async markVerified(userId) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        isVerified: true,
        status: 'ACTIVE',
        isActive: true,
        verifiedAt: new Date(),
        otpCode: null,
        otpExpires: null,
        otpPurpose: null,
      },
    });
  }


  async markEmailVerified(userId) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
        otpCode: null,
        otpExpires: null,
        otpPurpose: null,
      },
      select: userSafeSelect,
    });
  }

  async getUserByEmail(email) {
    return prisma.user.findUnique({ where: { email }, select: userSafeSelect });
  }

  async getUserByEmailWithPassword(email) {
    return prisma.user.findUnique({
      where: { email },
      select: { ...userSafeSelect, password: true },
    });
  }

  async getUserById(id) {
    return prisma.user.findUnique({ where: { id }, select: userSafeSelect });
  }

  async getUserByIdWithPassword(id) {
    return prisma.user.findUnique({
      where: { id },
      select: { ...userSafeSelect, password: true },
    });
  }

  async getUserByGoogleId(googleId) {
    return prisma.user.findUnique({ where: { googleId }, select: userSafeSelect });
  }

  async linkGoogleAccount(userId, googleId) {
    return prisma.user.update({ where: { id: userId }, data: { googleId } });
  }

  async getUserByResetToken(id) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        level: true,
        resetPasswordToken: true,
        resetPasswordExpires: true,
      },
    });
  }

  async createPendingUser({ email, preferredLanguage = 'it' }) {
    return prisma.user.create({
      data: {
        email,
        password: null,
        level: 'PRIVATE_USER',
        status: 'PENDING',
        isVerified: false,
        preferredLanguage,
      },
      select: userSafeSelect,
    });
  }


  async completeRegistration(userId, data) {
    const isPrivate = data.level === 'PRIVATE_USER';

    return prisma.$transaction(async (tx) => {
      let companyId = null;

      if (data.level === 'COMPANY_ADMIN' || data.level === 'LICENSE_USER') {
        let company = await tx.company.findUnique({
          where: { vatNumber: data.companyVatNumber },
        });

        if (!company) {
          company = await tx.company.create({
            data: {
              name: data.companyName,
              fiscalAddress: data.companyAddress,
              vatNumber: data.companyVatNumber,
              fiscalCode: data.companyTaxCode,
              pec: data.pec ?? null,
              uniqueCode: data.uniqueCode ?? null,
              logoUrl: data.logoUrl ?? null,
            },
          });
        }

        companyId = company.id;
      }

      return tx.user.update({
        where: { id: userId },
        data: {
          password: data.password,
          level: data.level,
          status: 'ACTIVE',
          isActive: true,
          profileCompleted: true,
          preferredLanguage: data.preferredLanguage ?? undefined,
          firstName: data.firstName ?? null,
          lastName: data.lastName ?? null,
          birthDate: isPrivate ? (data.birthDate ?? null) : null,
          city: isPrivate ? (data.city ?? null) : null,
          country: isPrivate ? (data.country ?? null) : null,
          traineeTaxCode: isPrivate ? (data.traineeTaxCode ?? null) : null,
          residenceAddress: isPrivate ? (data.residenceAddress ?? null) : null,
          membership: data.membership ?? null,
          citizenship: data.citizenship ?? null,
          companyName: !isPrivate ? (data.companyName ?? null) : null,
          companyAddress: !isPrivate ? (data.companyAddress ?? null) : null,
          companyTaxCode: !isPrivate ? (data.companyTaxCode ?? null) : null,
          companyVatNumber: !isPrivate ? (data.companyVatNumber ?? null) : null,
          companyPosition: !isPrivate ? (data.companyPosition ?? null) : null,
          serviceType: data.serviceType ?? null,
          contactNumber: data.contactNumber ?? null,
          consentGiven: data.consent ?? true,
          consentDate: new Date(),
          companyId,
        },
        select: userSafeSelect,
      });
    });
  }

  async updateLastLogin(id) {
    return prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
      select: userSafeSelect,
    });
  }

  async changePassword(id, hashedPassword) {
    return prisma.user.update({ where: { id }, data: { password: hashedPassword } });
  }

  async savePasswordResetToken(userId, hashedToken, expiresAt) {
    return prisma.user.update({
      where: { id: userId },
      data: { resetPasswordToken: hashedToken, resetPasswordExpires: expiresAt },
    });
  }

  async updatePasswordAndClearResetToken(userId, hashedPassword) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });
  }

  async verifyResetToken(plainToken, hashedToken) {
    if (!hashedToken) return false;
    return bcrypt.compare(plainToken, hashedToken);
  }

  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  async comparePassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }
}

export const authService = new AuthService();