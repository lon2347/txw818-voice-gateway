import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from '../models/api.model';
import { CreateOrderResponse, OrderStatusResponse, Package } from '../models/order.model';

@Injectable({
  providedIn: 'root'
})
export class OrderService {
  private http = inject(HttpClient);

  getPackages(): Observable<ApiResponse<Package[]>> {
    return this.http.get<ApiResponse<Package[]>>('/api/orders/packages');
  }

  createOrder(pkgId: number): Observable<ApiResponse<CreateOrderResponse>> {
    return this.http.post<ApiResponse<CreateOrderResponse>>('/api/orders', { pkg_id: pkgId });
  }

  getOrderStatus(orderNo: string): Observable<ApiResponse<OrderStatusResponse>> {
    return this.http.get<ApiResponse<OrderStatusResponse>>(`/api/orders/${encodeURIComponent(orderNo)}`);
  }
}

