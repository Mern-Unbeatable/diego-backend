import { ZodError as ZodNativeError } from 'zod';
import { ZodValidationError } from '@global/helpers/error-handler';

export function zodValidation(schema, asyncValidation = false) {
  return function (fn) {
    return async function (req, res, next) {
      try {
        let parsedData;

        if (asyncValidation) {
          parsedData = await schema.parseAsync(req.body ?? {});
        } else {
          const result = schema.safeParse(req.body ?? {});

          if (!result.success) {
            throw new ZodValidationError(result.error);
          }

          parsedData = result.data;
        }

        req.body = parsedData;

        return await fn(req, res, next);
      } catch (err) {
        if (err instanceof ZodNativeError) {
          return next(new ZodValidationError(err));
        }

        return next(err);
      }
    };
  };
}