export interface WalletResponse {
  balance_sec: number;
}

export interface PurchaseOrder {
  order_no: string;
  subject: string;
  amount: string | number;
  status: 'pending' | 'paid' | string;
  paid_at?: string;
}

export interface VoiceBill {
  session_id: string;
  seconds: number;
  started_at: string;
}

export interface BillsResponse {
  orders: PurchaseOrder[];
  bills: VoiceBill[];
}

