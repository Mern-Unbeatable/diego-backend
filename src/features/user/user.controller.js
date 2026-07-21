
import { config } from '../../config/config.js';
import { Logger } from '../../config/logger.js';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { userService } from './user.services.js';
import {
  updateProfileSchema,
  updateAvatarSchema,
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

  // ===== UPDATE PROFILE WITH AVATAR =====
  updateProfile = catchAsync(async (req, res) => {
    let avatar = null;

    if (req.file) {
      avatar = this._getFileUrl(req, req.file);
    } else if (req.files && req.files.avatar && req.files.avatar.length > 0) {
      avatar = this._getFileUrl(req, req.files.avatar[0]);
    }

    let payload = { ...req.body };
    if (avatar) {
      payload.avatar = avatar;
    }

    const validatedPayload = updateProfileSchema.parse(payload);
    const updated = await userService.updateProfile(req.user.id, validatedPayload);

    ResponseHandler.updated(res, {
      message: 'Profile updated successfully',
      data: { user: updated },
    });
  });

  // ===== UPDATE AVATAR ONLY - FIXED =====
  updateAvatar = catchAsync(async (req, res) => {

    let avatar = null;

    // Get the file from req.files.avatar (since it's working)
    if (req.files && req.files.avatar && req.files.avatar.length > 0) {
      const file = req.files.avatar[0];
      avatar = this._getFileUrl(req, file);
    }
    // Fallback: check req.file
    else if (req.file) {
      avatar = this._getFileUrl(req, req.file);
    }
    // Fallback: check if in body
    else if (req.body && req.body.avatar) {
      avatar = req.body.avatar;
    }

    if (!avatar) {
      throw new Error('Avatar image is required. Please upload a file with field name "avatar".');
    }


    const payload = { avatar: avatar };
    const validatedPayload = updateAvatarSchema.parse(payload);

    const updated = await userService.updateAvatar(req.user.id, validatedPayload);

    this.log.info(`Avatar updated for user ${req.user.id}`);
    ResponseHandler.updated(res, {
      message: 'Avatar updated successfully',
      data: { user: updated },
    });
  });


  _getFileUrl(req, file) {
    // If using Cloud storage (S3, Cloudinary, etc.)
    if (file.location) {
      return file.location;
    }


    const relativePath = file.path.replace(/^.*uploads[\\/]/, '');
    const url = `${req.protocol}://${req.get('host')}/uploads/${relativePath}`;
    return url;
  }

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