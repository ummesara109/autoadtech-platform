import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private admin: SupabaseClient | null = null;
  private configured = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('SUPABASE_URL');
    const key =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ??
      this.config.get<string>('SUPABASE_SECRET_KEY');

    if (!url || !key || url.includes('YOUR_PROJECT')) {
      this.logger.warn(
        'Supabase credentials missing — CMS_DEV_AUTH / seed mode required for local OTP',
      );
      return;
    }

    this.admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    this.configured = true;
  }

  get isConfigured() {
    return this.configured && !!this.admin;
  }

  get client(): SupabaseClient {
    if (!this.admin) {
      throw new Error('Supabase is not configured');
    }
    return this.admin;
  }
}
