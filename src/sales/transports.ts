export interface SalesSendResult {
  provider: string;
  externalId?: string;
}

export interface SalesEmailTransport {
  sendEmail(input: {
    to: string;
    subject?: string;
    message: string;
  }): Promise<SalesSendResult>;
}

export interface SalesWhatsAppTransport {
  sendWhatsApp(input: {
    to: string;
    message: string;
  }): Promise<SalesSendResult>;
}

export interface SalesTransports {
  email?: SalesEmailTransport;
  whatsapp?: SalesWhatsAppTransport;
}
