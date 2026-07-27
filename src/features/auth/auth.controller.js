import { config } from '../../config/config.js';
import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { Helpers } from '../../shared/globals/helpers/helpers.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { mailTransport } from '../../shared/services/emails/mail.transport.js';
import { authOtpService } from './auth.otp.service.js';
import { authService } from './auth.services.js';
import { verificationStore } from './auth.verification.store.js';
import {
  startRegistrationSchema,
  verifyRegistrationOtpSchema,
  completeRegistrationSchema,
  signinSchema,
  verifyOtpSchema,
  resendOtpSchema,
  changePasswordSchema,
  forgotPasswordSchema,
} from './auth.validation.js';
import { platformSettingService } from '../platformSetting/platformSetting.service.js';


const LEVEL_BY_ACCOUNT_TYPE = {
  PRIVATE: 'PRIVATE_USER',
  COMPANY: 'COMPANY_ADMIN',
  LICENSE: 'LICENSE_USER',
};

class AuthController {
  constructor() {
    this.log = new Logger('AuthController');
  }

  _setAuthCookies(res, accessToken, refreshToken) {
    const secure = config.NODE_ENV == 'development';
    res.cookie('accessToken', accessToken, {
      httpOnly: true, secure, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true, secure, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  _displayName(user) {
    if (user.company?.name) return user.company.name;
    const full = [user.firstName, user.lastName].filter(Boolean).join(' ');
    return full || user.email;
  }

  _signAccessToken(user) {
    return Helpers.generateAccessToken({
      id: user.id,
      email: user.email,
      level: user.level,
      preferredLanguage: user.preferredLanguage,
      companyId: user.companyId ?? null,
    });
  }

  _signRefreshToken(user) {
    return Helpers.generateRefreshToken({ id: user.id });
  }

  _guardSuspended(user) {
    if (user.status === 'SUSPENDED' || !user.isActive) {
      throw new Error('This account is suspended');
    }
  }

  startRegistration = catchAsync(async (req, res) => {
    await platformSettingService.assertRegistrationAllowed();

    const { email, preferredLanguage } = startRegistrationSchema.parse(req.body);
    this.log.info(`Registration start: ${email}`);

    let user = await authService.getUserByEmail(email);

    if (user && user.isVerified && user.profileCompleted) {
      throw new Error('Email is already in use');
    }

    if (!user) {
      user = await authService.createPendingUser({ email, preferredLanguage });
    }

    const otp = authService.generateOtp();
    await authService.saveOtp(user.id, otp, 'signup');
    try {
      await mailTransport.sendOtpEmail(user.email, otp, this._displayName(user), 'signup');
    } catch (e) {
      this.log.error(`OTP email failed: ${e.message}`);
      throw new Error('Failed to send verification code. Please try again later.');
    }

    this.log.info(`Registration OTP sent: ${user.email} (${user.id})`);

    ResponseHandler.created(res, {
      message: 'A verification code has been sent to your email.',
      data: {
        userId: user.id,
        email: user.email,
        isVerified: false,
        preferredLanguage: user.preferredLanguage,
        otp
        // ...(config.NODE_ENV === 'development' && { otp }),
      },
    });
  });

  verifyRegistrationOtp = catchAsync(async (req, res) => {
    const { email, otp } = verifyRegistrationOtpSchema.parse(req.body);
    this.log.info(`Verify registration OTP: ${email}`);

    const user = await authOtpService.verifyOtpFlow({ email, otp, expectedPurpose: 'signup' });
    await authService.markEmailVerified(user.id);

    const registrationToken = Helpers.generateRegistrationToken({
      id: user.id,
      email: user.email,
    });

    ResponseHandler.success(res, {
      message: 'Email verified. Continue to set up your profile.',
      data: { userId: user.id, email: user.email, registrationToken },
    });
  });

  completeRegistration = catchAsync(async (req, res) => {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.substring(7)
      : req.body.registrationToken;

    const decoded = token ? Helpers.verifyRegistrationToken(token) : null;
    if (!decoded?.id) {
      throw new Error('Invalid or expired registration session. Please verify your email again.');
    }

    const payload = completeRegistrationSchema.parse(req.body);
    const level = LEVEL_BY_ACCOUNT_TYPE[payload.accountType];

    if (!level) {
      throw new Error(`Unsupported account type: ${payload.accountType}`);
    }

    const isPrivate = payload.accountType === 'PRIVATE';

    const existing = await authService.getUserById(decoded.id);
    if (!existing) throw new Error('User not found');
    if (!existing.isVerified) throw new Error('Email not verified');
    if (existing.profileCompleted) throw new Error('Profile already completed. Please sign in.');

    const hashedPassword = await authService.hashPassword(payload.password);

    const user = await authService.completeRegistration(decoded.id, {
      level,
      password: hashedPassword,
      consent: payload.consent ?? true,
      preferredLanguage: payload.preferredLanguage,
      citizenship: payload.citizenship ?? null,
      firstName: payload.firstName?.trim(),
      lastName: payload.lastName?.trim(),
      // private fields
      birthDate: isPrivate ? new Date(payload.birthDate) : null,
      city: isPrivate ? payload.city?.trim() : null,
      country: isPrivate ? payload.country?.trim() : null,
      traineeTaxCode: isPrivate ? payload.traineeTaxCode?.trim() : null,
      residenceAddress: isPrivate ? payload.residenceAddress?.trim() : null,
      membership: isPrivate ? payload.membership?.trim() : null,
      // company fields
      companyName: !isPrivate ? payload.companyName?.trim() : null,
      companyAddress: !isPrivate ? payload.companyAddress?.trim() : null,
      companyVatNumber: !isPrivate ? payload.companyVatNumber?.trim() : null,
      companyTaxCode: !isPrivate ? payload.companyTaxCode?.trim() : null,
      companyPosition: !isPrivate ? payload.companyPosition?.trim() : null,
      pec: !isPrivate ? payload.pec?.trim() : null,
      uniqueCode: !isPrivate ? payload.uniqueCode?.trim() : null,
      logoUrl: !isPrivate ? (payload.logoUrl ?? null) : null,
      serviceType: payload.serviceType?.trim() ?? null,
      contactNumber: payload.contactNumber?.trim() ?? null,
    });

    await authService.updateLastLogin(user.id);

    const tokens = await authOtpService.issueTokens(user);
    this._setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    await mailTransport
      .sendWelcomeEmail(user.email, this._displayName(user))
      .catch((e) => this.log.error(`Welcome email failed: ${e.message}`));

    this.log.info(`Registration completed: ${user.email} (${user.id})`);

    ResponseHandler.created(res, {
      message: 'Registration completed successfully. Welcome!',
      data: { user, ...tokens },
    });
  });


  signIn = catchAsync(async (req, res) => {
    const { email } = signinSchema.parse(req.body);
    this.log.info(`Login attempt: ${email}`);

    const user = await authService.getUserByEmail(email);
    if (!user) throw new Error('Invalid email or password');

    if (!user.isVerified) {
      throw new Error('Please verify your email first. Check your inbox for the verification code.');
    }

    if (!user.profileCompleted) {
      throw new Error('Please complete your registration before signing in.');
    }

    this._guardSuspended(user);
    await platformSettingService.assertLoginAllowed(user, req.locale);

    const otp = authService.generateOtp();
    await authService.saveOtp(user.id, otp, 'login');

    try {
      await mailTransport.sendOtpEmail(user.email, otp, this._displayName(user), 'login');
    } catch (e) {
      this.log.error(`Login OTP email failed: ${e.message}`);
      throw new Error('Failed to send verification code. Please try again later.');
    }

    this.log.info(`Login OTP sent: ${user.email} (${user.id})`);

    ResponseHandler.success(res, {
      message: 'A verification code has been sent to your email.',
      data: {
        userId: user.id,
        email: user.email,
        otp
        // ...(config.NODE_ENV === 'development' && { otp }),
      },
    });
  });

  verifyLoginOtp = catchAsync(async (req, res) => {
    const { email, otp } = verifyOtpSchema.parse(req.body);
    this.log.info(`Verify login OTP: ${email}`);

    const user = await authOtpService.verifyOtpFlow({ email, otp, expectedPurpose: 'login' });
    this._guardSuspended(user);
    await platformSettingService.assertLoginAllowed(user, req.locale);

    const tokens = await authOtpService.issueTokens(user);
    await authService.updateLastLogin(user.id);
    this._setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    ResponseHandler.success(res, { message: 'Login successful', data: { user, ...tokens } });
  });

  resendOtp = catchAsync(async (req, res) => {
    const { email, purpose } = resendOtpSchema.parse(req.body);
    this.log.info(`Resend OTP: ${email}`);

    const user = await authService.getUserByEmail(email);
    if (!user) throw new Error('User not found');

    const otpPurpose = purpose ?? (user.isVerified ? 'login' : 'signup');
    const otp = authService.generateOtp();
    await authService.saveOtp(user.id, otp, otpPurpose);
    try {
      await mailTransport.sendOtpEmail(user.email, otp, this._displayName(user), otpPurpose);
    } catch (e) {
      this.log.error(`Resend OTP failed: ${e.message}`);
      throw new Error('Failed to resend verification code. Please try again later.');
    }

    ResponseHandler.success(res, {
      message: 'A new verification code has been sent to your email.',
      data: { email: user.email, ...(config.NODE_ENV === 'development' && { otp }) },
    });
  });

  refreshToken = catchAsync(async (req, res) => {
    let refreshToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.substring(7)
      : req.cookies?.refreshToken;

    if (!refreshToken) throw new Error('Refresh token required');

    const decoded = Helpers.verifyRefreshToken(refreshToken);
    if (!decoded?.id) throw new Error('Invalid or expired refresh token');

    const user = await authService.getUserById(decoded.id);
    if (!user) throw new Error('User not found');
    this._guardSuspended(user);
    await platformSettingService.assertLoginAllowed(user, req.locale);

    const newAccessToken = this._signAccessToken(user);

    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: config.NODE_ENV !== 'development',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });

    this.log.info(`Token refreshed: ${user.id}`);

    ResponseHandler.success(res, {
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        user: { id: user.id, email: user.email, level: user.level, status: user.status, preferredLanguage: user.preferredLanguage },
      },
    });
  });

  signOut = catchAsync(async (req, res) => {
    const cookieOptions = {
      httpOnly: true, secure: config.NODE_ENV !== 'development', sameSite: 'lax', path: '/',
    };
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('userSession', cookieOptions);

    ResponseHandler.success(res, {
      message: 'Logged out successfully',
      data: { timestamp: new Date().toISOString() },
    });
  });

  forgotPassword = catchAsync(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    this.log.info(`Forgot password: ${email}`);

    const user = await authService.getUserByEmail(email);
    if (!user) throw new Error('No account found with this email address');

    verificationStore.clearVerified(email);

    const otp = authService.generateOtp();
    await authService.saveOtp(user.id, otp, 'password_reset');

    try {
      await mailTransport.sendOtpEmail(user.email, otp, this._displayName(user), 'password_reset');
    } catch (e) {
      this.log.error(`Failed to send reset OTP: ${e.message}`);
      throw new Error('Failed to send reset code. Please try again later.');
    }

    ResponseHandler.success(res, {
      message: 'A password reset code has been sent to your email.',
      data: { email: user.email, ...(config.NODE_ENV === 'development' && { otp }) },
    });
  });

  verifyResetOtp = catchAsync(async (req, res) => {
    const { otp, email } = req.body;
    if (!email) throw new Error('Email is required');
    if (!otp) throw new Error('OTP is required');

    const user = await authOtpService.verifyOtpFlow({ email, otp, expectedPurpose: 'password_reset' });
    verificationStore.setVerified(email);

    ResponseHandler.success(res, {
      message: 'OTP verified. You can now reset your password.',
      data: { email: user.email, verified: true },
    });
  });

  resetPassword = catchAsync(async (req, res) => {
    const { newPassword, confirmPassword, email } = req.body;

    if (!email) throw new Error('Email is required');
    if (newPassword !== confirmPassword) throw new Error("Passwords don't match");
    if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');

    if (!verificationStore.isVerified(email)) {
      throw new Error('Please verify your OTP first. Verification may have expired.');
    }

    const user = await authService.getUserByEmail(email);
    if (!user) throw new Error('User not found');

    const hashedPassword = await authService.hashPassword(newPassword);
    await authService.changePassword(user.id, hashedPassword);
    await authService.clearOtp(user.id);
    verificationStore.clearVerified(email);

    mailTransport
      .sendPasswordChangedEmail(user.email, this._displayName(user))
      .catch((e) => this.log.error(`Password changed email failed: ${e.message}`));

    ResponseHandler.success(res, { message: 'Password reset successfully.' });
  });

  changePassword = catchAsync(async (req, res) => {
    if (!req.user?.id) throw new Error('User not authenticated');

    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await authService.getUserByIdWithPassword(req.user.id);
    if (!user) throw new Error('User not found');

    const isMatch = await authService.comparePassword(currentPassword, user.password);
    if (!isMatch) throw new Error('Current password is incorrect');

    const hashedPassword = await authService.hashPassword(newPassword);
    await authService.changePassword(req.user.id, hashedPassword);

    mailTransport
      .sendPasswordChangedEmail(user.email, this._displayName(user))
      .catch((e) => this.log.error(`Password changed email failed: ${e.message}`));

    ResponseHandler.updated(res, { message: 'Password changed successfully' });
  });
}

export const authController = new AuthController();
export { AuthController };