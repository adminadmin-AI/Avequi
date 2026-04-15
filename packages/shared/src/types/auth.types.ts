export type UserRole =
  | 'SUPER_ADMIN'
  | 'DIRECTOR'
  | 'MANAGER'
  | 'COMMERCIAL'
  | 'PRODUCTION'
  | 'QUALITY'
  | 'WAREHOUSE'
  | 'FINANCIAL'
  | 'STORE'
  | 'READER';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  companyId: string;
  iat?: number;
  exp?: number;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    companyId: string;
  };
}
