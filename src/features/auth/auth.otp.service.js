import { authService } from './auth.services.js';
import { Helpers } from '../../shared/globals/helpers/helpers.js';

class AuthOtpService {
  async verifyOtpFlow({ email, otp, expectedPurpose }) {
    const user = await authService.getUserByEmail(email);
    if (!user) throw new Error('User not found');

    const result = await authService.verifyOtp(user.id, otp);
    if (!result.valid) throw new Error(result.reason);
    if (result.purpose !== expectedPurpose) throw new Error('Invalid OTP purpose');

    await authService.clearOtp(user.id);
    return user;
  }

  async issueTokens(user) {
    return {
      accessToken: Helpers.generateAccessToken({
        id: user.id,
        email: user.email,
        level: user.level,
        preferredLanguage: user.preferredLanguage,
        companyId: user.companyId ?? null,
        tenantId: user.tenantId ?? null,
      }),
      refreshToken: Helpers.generateRefreshToken({ id: user.id }),
    };
  }
}

export const authOtpService = new AuthOtpService();