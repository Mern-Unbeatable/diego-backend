import { config } from '../../config/config.js';
import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { userService } from './user.services.js';

import {
  updateProfileSchema,
  setVerifiedSchema,
  setStatusSchema,
} from './user.validation.js';

class UserController {
  constructor() {
    this.log = new Logger('UserController');
  }

  getMe = catchAsync(async (req, res) => {
    const user = await userService.getFullProfile(req.user.id, req.locale);
    if (!user) throw new Error('User not found');
    ResponseHandler.success(res, {
      message: 'Profile fetched successfully',
      data: { user },
    });
  });

  getMyStats = catchAsync(async (req, res) => {
    const stats = await userService.getUserStats(req.user.id);
    ResponseHandler.success(res, {
      message: 'User statistics fetched',
      data: { stats },
    });
  });

  getMyEnrollments = catchAsync(async (req, res) => {
    const result = await userService.getMyEnrollments(
      req.user.id,
      req.query,
      req.locale
    );
    ResponseHandler.success(res, {
      message: 'Enrollments fetched',
      data: result,
    });
  });

  updateProfile = catchAsync(async (req, res) => {
    const payload = updateProfileSchema.parse(req.body);
    const updated = await userService.updateProfile(req.user.id, payload);
    ResponseHandler.updated(res, {
      message: 'Profile updated successfully',
      data: { user: updated },
    });
  });

  deleteMe = catchAsync(async (req, res) => {
    await userService.deleteUser(req.user.id);

    const cookieOptions = {
      httpOnly: true,
      secure: config.NODE_ENV !== 'development',
      sameSite: 'lax',
      path: '/',
    };
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('userSession', cookieOptions);

    ResponseHandler.success(res, {
      message: 'Account deleted successfully',
      data: { deletedAt: new Date().toISOString() },
    });
  });


  getAllUsers = catchAsync(async (req, res) => {
    const result = await userService.getAllUsers(req.query);
    ResponseHandler.success(res, {
      message: 'Users fetched',
      data: result,
    });
  });

  getUserById = catchAsync(async (req, res) => {
    const user = await userService.getUserWithDetails(req.params.id, req.locale);
    if (!user) throw new Error('User not found');
    ResponseHandler.success(res, {
      message: 'User fetched',
      data: { user },
    });
  });

  setUserVerified = catchAsync(async (req, res) => {
    const { isVerified } = setVerifiedSchema.parse(req.body);
    const user = await userService.setVerified(req.params.id, isVerified);
    ResponseHandler.updated(res, {
      message: `User ${isVerified ? 'verified' : 'unverified'} successfully`,
      data: { user },
    });
  });

  setUserStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    if (id === req.user.id) {
      throw new Error('You cannot change your own status');
    }

    const { status } = setStatusSchema.parse(req.body);
    const user = await userService.setStatus(id, status);
    ResponseHandler.updated(res, {
      message: 'User status updated',
      data: { user },
    });
  });

  deleteUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    if (id === req.user.id) {
      throw new Error('Use DELETE /me to delete your own account');
    }

    const deleted = await userService.deleteUser(id);
    ResponseHandler.success(res, {
      message: 'User deleted',
      data: { userId: deleted.id, deletedAt: new Date().toISOString() },
    });
  });
}

export const userController = new UserController();
export { UserController };