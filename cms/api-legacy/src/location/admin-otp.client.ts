import { Injectable, Logger } from '@nestjs/common';

export type AdminOtpIssuePayload = {
  challengeId: string;
  autoNumber: string;
  cmsVehicleId: string;
  cmsOperatorId: string;
  maskedMobile: string;
  mobileE164: string;
};

export type AdminOtpIssueResult = {
  ok: boolean;
  challengeId: string;
  expiresAt: string;
  expiresInSec?: number;
  channel?: string;
  delivery?: string;
};

/**
 * Nest → Admin OTP (server-to-server).
 * Reuses ADMIN_GPS_URL / ADMIN_API_URL + CMS_GPS_INGEST_KEY (never exposed to PWA).
 */
@Injectable()
export class AdminOtpClient {
  private readonly logger = new Logger(AdminOtpClient.name);

  private baseUrl(): string {
    return (
      process.env.ADMIN_GPS_URL ||
      process.env.ADMIN_API_URL ||
      ''
    )
      .trim()
      .replace(/\/+$/, '');
  }

  private ingestKey(): string {
    return String(process.env.CMS_GPS_INGEST_KEY || '').trim();
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl() && this.ingestKey());
  }

  async issue(payload: AdminOtpIssuePayload): Promise<AdminOtpIssueResult> {
    if (!this.isConfigured) {
      throw new Error(
        'Admin OTP not configured — set ADMIN_GPS_URL and CMS_GPS_INGEST_KEY on Nest',
      );
    }
    const url = `${this.baseUrl()}/api/cms/otp/request`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cms-ingest-key': this.ingestKey(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    const text = await res.text().catch(() => '');
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      const msg =
        (json.error as string) ||
        (json.message as string) ||
        `Admin OTP issue failed (${res.status})`;
      this.logger.warn(`Admin OTP issue ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(msg);
    }
    return {
      ok: true,
      challengeId: String(json.challengeId || payload.challengeId),
      expiresAt: String(json.expiresAt || ''),
      expiresInSec:
        typeof json.expiresInSec === 'number' ? json.expiresInSec : undefined,
      channel: json.channel ? String(json.channel) : 'admin_dashboard',
      delivery: json.delivery ? String(json.delivery) : undefined,
    };
  }

  async verify(challengeId: string, otp: string): Promise<boolean> {
    if (!this.isConfigured) {
      throw new Error('Admin OTP not configured');
    }
    const url = `${this.baseUrl()}/api/cms/otp/verify`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cms-ingest-key': this.ingestKey(),
      },
      body: JSON.stringify({ challengeId, otp }),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401) return false;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Admin OTP verify ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`Admin OTP verify failed (${res.status})`);
    }
    return true;
  }
}
