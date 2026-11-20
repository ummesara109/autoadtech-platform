package com.niyoads.silentgps;

import android.content.Context;
import android.content.SharedPreferences;

/** Persists FGS session so tracking can recover after process recreation. */
final class SilentGpsPrefs {
    private static final String NAME = "niyoads_silent_gps";
    private static final String KEY_ACTIVE = "tracking_active";
    private static final String KEY_TOKEN = "access_token";
    private static final String KEY_API = "api_base_url";
    private static final String KEY_INTERVAL = "interval_ms";
    private static final String KEY_DEVICE = "device_id";

    private SilentGpsPrefs() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    static void save(
            Context ctx,
            String accessToken,
            String apiBaseUrl,
            long intervalMs,
            String deviceId
    ) {
        prefs(ctx)
                .edit()
                .putBoolean(KEY_ACTIVE, true)
                .putString(KEY_TOKEN, accessToken)
                .putString(KEY_API, apiBaseUrl)
                .putLong(KEY_INTERVAL, intervalMs)
                .putString(KEY_DEVICE, deviceId == null ? "" : deviceId)
                .apply();
    }

    static void clear(Context ctx) {
        prefs(ctx).edit().clear().apply();
    }

    static boolean isActive(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ACTIVE, false);
    }

    static String token(Context ctx) {
        return prefs(ctx).getString(KEY_TOKEN, "");
    }

    static String apiBaseUrl(Context ctx) {
        return prefs(ctx).getString(KEY_API, "");
    }

    static long intervalMs(Context ctx) {
        return prefs(ctx).getLong(KEY_INTERVAL, 15_000L);
    }

    static String deviceId(Context ctx) {
        return prefs(ctx).getString(KEY_DEVICE, "");
    }
}
