package com.niyoads.silentgps;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/**
 * After reboot / package replace, restart FGS only if a prior authenticated
 * tracking session was persisted (logout clears prefs).
 */
public class SilentGpsBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!SilentGpsPrefs.isActive(context)) return;
        String token = SilentGpsPrefs.token(context);
        String api = SilentGpsPrefs.apiBaseUrl(context);
        if (token == null || token.isEmpty() || api == null || api.isEmpty()) {
            SilentGpsPrefs.clear(context);
            return;
        }
        Intent svc = new Intent(context, LocationForegroundService.class);
        svc.setAction(LocationForegroundService.ACTION_START);
        ContextCompat.startForegroundService(context, svc);
    }
}
