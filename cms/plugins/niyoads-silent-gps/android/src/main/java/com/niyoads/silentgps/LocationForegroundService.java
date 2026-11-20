package com.niyoads.silentgps;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Foreground location service with a persistent notification.
 * Posts real GPS fixes to Nest POST /api/location — never invents coordinates.
 */
public class LocationForegroundService extends Service {
    public static final String ACTION_START = "com.niyoads.silentgps.START";
    public static final String ACTION_STOP = "com.niyoads.silentgps.STOP";

    private static final String TAG = "NiyoAdsSilentGps";
    private static final String CHANNEL_ID = "niyoads_silent_gps";
    private static final int NOTIFICATION_ID = 41041;

    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private HandlerThread worker;
    private Handler workerHandler;
    private long lastPostAt = 0L;
    private volatile boolean running = false;

    @Override
    public void onCreate() {
        super.onCreate();
        fused = LocationServices.getFusedLocationProviderClient(this);
        worker = new HandlerThread("niyoads-gps-post");
        worker.start();
        workerHandler = new Handler(worker.getLooper());
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            teardown(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!SilentGpsPrefs.isActive(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        startUpdates();
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        teardown(false);
        if (worker != null) {
            worker.quitSafely();
            worker = null;
        }
        super.onDestroy();
    }

    private void startUpdates() {
        if (running) return;
        running = true;
        long interval = Math.max(5_000L, SilentGpsPrefs.intervalMs(this));

        LocationRequest request = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                interval
        )
                .setMinUpdateIntervalMillis(interval)
                .setMinUpdateDistanceMeters(0f)
                .build();

        callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (!SilentGpsPrefs.isActive(LocationForegroundService.this)) {
                    teardown(false);
                    stopSelf();
                    return;
                }
                if (result == null) return;
                Location loc = result.getLastLocation();
                if (loc == null) return;
                maybePost(loc);
            }
        };

        try {
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper());
        } catch (SecurityException se) {
            Log.w(TAG, "Location permission missing — stopping FGS", se);
            teardown(true);
            stopSelf();
        }
    }

    private void maybePost(Location loc) {
        long now = System.currentTimeMillis();
        long interval = Math.max(5_000L, SilentGpsPrefs.intervalMs(this));
        if (now - lastPostAt < interval) return;
        lastPostAt = now;

        final String token = SilentGpsPrefs.token(this);
        final String apiBase = SilentGpsPrefs.apiBaseUrl(this);
        final String deviceId = SilentGpsPrefs.deviceId(this);
        if (token == null || token.isEmpty() || apiBase == null || apiBase.isEmpty()) {
            teardown(true);
            stopSelf();
            return;
        }

        workerHandler.post(() -> postFix(apiBase, token, deviceId, loc));
    }

    private void postFix(String apiBase, String token, String deviceId, Location loc) {
        HttpURLConnection conn = null;
        try {
            String base = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
            URL url = new URL(base + "/api/location");
            JSONObject body = new JSONObject();
            body.put("lat", loc.getLatitude());
            body.put("lng", loc.getLongitude());
            if (loc.hasAccuracy()) {
                body.put("accuracy", loc.getAccuracy());
            }
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            body.put("recordedAt", iso.format(new Date(loc.getTime())));
            if (deviceId != null && !deviceId.isEmpty()) {
                body.put("deviceId", deviceId);
            }

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(12_000);
            conn.setReadTimeout(12_000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }
            int code = conn.getResponseCode();
            if (code == 401 || code == 403) {
                Log.w(TAG, "Session rejected (" + code + ") — stopping GPS");
                new Handler(Looper.getMainLooper()).post(() -> {
                    teardown(true);
                    stopSelf();
                });
            } else if (code < 200 || code >= 300) {
                Log.w(TAG, "Location POST failed HTTP " + code);
            }
        } catch (Exception e) {
            // Offline / network — drop silently; next fix retries. No simulated GPS.
            Log.w(TAG, "Location POST error: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void teardown(boolean clearPrefs) {
        running = false;
        if (fused != null && callback != null) {
            try {
                fused.removeLocationUpdates(callback);
            } catch (Exception ignored) {
            }
            callback = null;
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (clearPrefs) {
            SilentGpsPrefs.clear(this);
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Vehicle location",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps Auto Display location active while you are signed in");
        channel.setShowBadge(false);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = null;
        if (launch != null) {
            pi = PendingIntent.getActivity(
                    this,
                    0,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Auto Display location active")
                .setContentText("Signed-in vehicle location is updating")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pi)
                .build();
    }
}
