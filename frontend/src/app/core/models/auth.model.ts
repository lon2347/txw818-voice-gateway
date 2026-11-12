export interface User {
  id: number;
  phone: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface SendSmsResponse {
  debugCode?: string;
}

