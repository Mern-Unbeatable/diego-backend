import express from 'express';
import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { enrollmentService } from './enrollment.service.js';
import { redeemAccessLinkSchema } from './enrollment.validation.js';

const router = express.Router({ mergeParams: true });

router.get(
    '/:token',
    catchAsync(async (req, res) => {
        const info = await enrollmentService.getAccessLinkInfo(req.params.token);
        ResponseHandler.success(res, {
            message: 'Access link info fetched',
            data: info,
        });
    }),
);

router.post(
    '/:token/redeem',
    catchAsync(async (req, res) => {
        const payload = redeemAccessLinkSchema.parse(req.body);
        const result = await enrollmentService.redeemAccessLink(req.params.token, payload);
        ResponseHandler.success(res, {
            message: 'Access link redeemed successfully',
            data: result,
        });
    }),
);

export const enrollmentPublicRoutes = router;
