import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from '../models/api.model';
import { Device, ResolveDeviceResponse } from '../models/device.model';

@Injectable({
  providedIn: 'root'
})
export class DeviceService {
  private http = inject(HttpClient);

  resolveDevice(deviceId: string): Observable<ApiResponse<ResolveDeviceResponse>> {
    return this.http.post<ApiResponse<ResolveDeviceResponse>>('/api/devices/resolve', { device_id: deviceId });
  }

  bindDevice(deviceId: string): Observable<ApiResponse<{ device_id: string }>> {
    return this.http.post<ApiResponse<{ device_id: string }>>('/api/devices/bind', { device_id: deviceId });
  }

  getMyDevices(): Observable<ApiResponse<Device[]>> {
    return this.http.get<ApiResponse<Device[]>>('/api/devices');
  }
}

