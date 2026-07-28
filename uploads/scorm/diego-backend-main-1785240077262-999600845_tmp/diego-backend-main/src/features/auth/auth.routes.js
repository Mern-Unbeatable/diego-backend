import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { authController } from './auth.controller.js';

const router = express.Router();

router.post('/register/start', authController.startRegistration);
router.post('/register/verify-otp', authController.verifyRegistrationOtp);
router.post('/register/complete', authController.completeRegistration);
router.post('/register/resend-otp', authController.resendOtp);
router.post('/signin', authController.signIn);
router.post('/verify-login-otp', authController.verifyLoginOtp);
router.post('/resend-otp', authController.resendOtp);
router.post('/refresh-token', authController.refreshToken);
router.post('/signout', authMiddleware.protect, authController.signOut);

router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/reset-password', authController.resetPassword);
router.patch('/change-password', authMiddleware.protect, authController.changePassword);

export const authRoutes = router;