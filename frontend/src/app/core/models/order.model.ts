export interface Package {
  id: number;
  name: string;
  minutes: number;
  price: string | number;
}

export interface CreateOrderResponse {
  order_no: string;
  pay_url: string;
}

export interface OrderStatusResponse {
  order_no: string;
  status: 'pending' | 'paid' | string;
  paid_at?: string;
}

