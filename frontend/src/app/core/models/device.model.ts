export interface Device {
  device_id: string;
  status: 'bound' | 'unbound' | 'disabled' | string;
  created_at?: string;
}

export interface ResolveDeviceResponse {
  device_id: string;
  bound: boolean;
  status: string;
}

