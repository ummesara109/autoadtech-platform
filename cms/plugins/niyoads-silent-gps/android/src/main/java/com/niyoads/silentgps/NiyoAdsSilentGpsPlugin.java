package com.niyoads.silentgps;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * JS bridge: window / Capacitor NiyoAdsSilentGps.start|stop
 * Starts Android foreground location service after OTP; stops on logout.
 */
@CapacitorPlugin(
        name = "NiyoAdsSilentGps",
        permissions = {
                @Permission(
                        alias = "location",
                        strings = {
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                                Manifest.permission.ACCESS_FINE_LOCATION
                        }
                ),
                @Permission(
                        alias = "notifications",
                        strings = { Manifest.permission.POST_NOTIFICATIONS }
                )
        }
)
public class NiyoAdsSilentGpsPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String token = call.getString("accessToken");
        String apiBaseUrl = call.getString("apiBaseUrl");
        if (token == null || token.trim().isEmpty()) {
            call.reject("accessToken required");
            return;
        }
        if (apiBaseUrl == null || apiBaseUrl.trim().isEmpty()) {
            call.reject("apiBaseUrl required (absolute Nest origin)");
            return;
        }

        Integer interval = call.getInt("intervalMs");
        long intervalMs = interval == null ? 15_000L : Math.max(5_000L, interval.longValue());
        String deviceId = call.getString("deviceId", "");

        SilentGpsPrefs.save(
                getContext(),
                token.trim(),
                apiBaseUrl.trim(),
                intervalMs,
                deviceId == null ? "" : deviceId.trim()
        );

        if (!hasLocationPermission()) {
            requestPermissionForAlias("location", call, "onLocationPerm");
            return;
        }
        maybeRequestNotificationsThenStart(call);
    }

    @PermissionCallback
    private void onLocationPerm(PluginCall call) {
        if (!hasLocationPermission()) {
            SilentGpsPrefs.clear(getContext());
            call.reject("Location permission denied");
            return;
        }
        maybeRequestNotificationsThenStart(call);
    }

    @PermissionCallback
    private void onNotifPerm(PluginCall call) {
        // Notification denial still allows FGS on many devices; proceed.
        startServiceAndResolve(call);
    }

    private void maybeRequestNotificationsThenStart(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(
                        getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "onNotifPerm");
            return;
        }
        startServiceAndResolve(call);
    }

    private void startServiceAndResolve(PluginCall call) {
        Intent svc = new Intent(getContext(), LocationForegroundService.class);
        svc.setAction(LocationForegroundService.ACTION_START);
        ContextCompat.startForegroundService(getContext(), svc);

        JSObject ret = new JSObject();
        ret.put("started", true);
        ret.put("platform", "android");
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        // Clear prefs first so BootReceiver / START_STICKY will not revive tracking.
        SilentGpsPrefs.clear(getContext());
        Intent svc = new Intent(getContext(), LocationForegroundService.class);
        try {
            getContext().stopService(svc);
        } catch (Exception ignored) {
        }

        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", SilentGpsPrefs.isActive(getContext()));
        call.resolve(ret);
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(
                        getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(
                                getContext(), Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
    }
}
