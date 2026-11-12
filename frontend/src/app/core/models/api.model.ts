export interface ApiResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

export const ErrorCode = {
  SUCCESS: 0,
  UNAUTHORIZED: 401,
  PARAM_ERROR: 4001,
  VERIFY_CODE_ERROR: 4002,
  DEVICE_NOT_FOUND: 4040,
  DEVICE_ALREADY_BOUND: 4090,
  PACKAGE_NOT_FOUND: 4041,
  SERVER_ERROR: 500,
} as const;

