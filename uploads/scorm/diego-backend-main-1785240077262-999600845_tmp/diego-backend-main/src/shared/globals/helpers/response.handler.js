export class ResponseHandler {
  static success(
    res,
    {
      message = 'Success',
      data,
      meta,
      statusCode = 200,
    },
  ) {
    const response = {
      success: true,
      message,
      data,
    };

    if (meta) {
      response.meta = meta;
    }

    return res.status(statusCode).json(response);
  }

  static created(
    res,
    { message = 'Resource created successfully', data },
  ) {
    return this.success(res, {
      message,
      data,
      statusCode: 201,
    });
  }

  static updated(
    res,
    { message = 'Resource updated successfully', data },
  ) {
    return this.success(res, { message, data });
  }

  static deleted(
    res,
    { message = 'Resource deleted successfully' },
  ) {
    return this.success(res, { message });
  }
}