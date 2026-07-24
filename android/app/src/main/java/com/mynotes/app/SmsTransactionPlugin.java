package com.mynotes.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

import java.util.Calendar;

@CapacitorPlugin(
    name = "SmsTransaction",
    permissions = {
        @Permission(
            strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS },
            alias = "sms"
        )
    }
)
public class SmsTransactionPlugin extends Plugin {

    private static final String TAG = "SmsTransactionPlugin";

    @Override
    public void load() {
        super.load();
        Log.i(TAG, "✅ SmsTransactionPlugin loaded successfully");

        SmsReceiver.setListener(new SmsReceiver.SmsListener() {
            @Override
            public void onSmsReceived(JSONObject smsData) {
                try {
                    Log.i(TAG, "Real-time SMS received, forwarding to JS...");
                    JSObject jsObj = JSObject.fromJSONObject(smsData);
                    notifyListeners("smsTransactionReceived", jsObj);
                } catch (Exception e) {
                    Log.e(TAG, "Error notifying sms listener", e);
                }
            }
        });
    }

    private boolean hasSmsPermission() {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
        Log.d(TAG, "hasSmsPermission: " + granted);
        return granted;
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        Log.i(TAG, "checkPermissions called from JS");
        JSObject res = new JSObject();
        boolean granted = hasSmsPermission();
        res.put("sms", granted ? "granted" : "prompt");
        Log.i(TAG, "checkPermissions returning: " + (granted ? "granted" : "prompt"));
        call.resolve(res);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        Log.i(TAG, "requestPermissions called from JS");
        if (hasSmsPermission()) {
            JSObject res = new JSObject();
            res.put("sms", "granted");
            Log.i(TAG, "Permission already granted");
            call.resolve(res);
        } else {
            Log.i(TAG, "Requesting SMS permission from user...");
            requestPermissionForAlias("sms", call, "permissionsCallback");
        }
    }

    @PermissionCallback
    public void permissionsCallback(PluginCall call) {
        Log.i(TAG, "permissionsCallback invoked");
        JSObject res = new JSObject();
        boolean granted = hasSmsPermission();
        res.put("sms", granted ? "granted" : "denied");
        Log.i(TAG, "Permission callback result: " + (granted ? "granted" : "denied"));
        call.resolve(res);
    }

    @PluginMethod
    public void scanInbox(PluginCall call) {
        Log.i(TAG, "scanInbox called from JS");

        if (!hasSmsPermission()) {
            Log.i(TAG, "No SMS permission, requesting before scan...");
            requestPermissionForAlias("sms", call, "scanInboxCallback");
            return;
        }

        performScan(call);
    }

    @PermissionCallback
    public void scanInboxCallback(PluginCall call) {
        Log.i(TAG, "scanInboxCallback invoked");
        if (hasSmsPermission()) {
            performScan(call);
        } else {
            Log.w(TAG, "SMS permission denied by user after prompt");
            call.reject("SMS permission denied by user");
        }
    }

    private void performScan(PluginCall call) {
        int limit = call.getInt("limit", 200);
        Log.i(TAG, "performScan starting with limit=" + limit);

        JSArray results = new JSArray();

        try {
            ContentResolver cr = getContext().getContentResolver();
            Uri uri = Uri.parse("content://sms/inbox");

            // Get current month start timestamp for filtering
            Calendar cal = Calendar.getInstance();
            cal.set(Calendar.DAY_OF_MONTH, 1);
            cal.set(Calendar.HOUR_OF_DAY, 0);
            cal.set(Calendar.MINUTE, 0);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            long monthStartMs = cal.getTimeInMillis();

            Log.i(TAG, "Filtering SMS from date >= " + monthStartMs + " (" + cal.getTime() + ")");

            int count = queryAndParse(cr, uri, limit, results, monthStartMs);

            JSObject res = new JSObject();
            res.put("transactions", results);
            res.put("count", count);
            Log.i(TAG, "performScan complete: " + count + " transactions parsed, resolving to JS");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Failed to scan SMS inbox", e);
            call.reject("Failed to scan SMS inbox: " + e.getMessage());
        }
    }

    private int queryAndParse(ContentResolver cr, Uri uri, int limit, JSArray results, long sinceTimestamp) {
        Cursor cursor = null;
        int count = 0;
        int totalRead = 0;
        int financialSkipped = 0;

        try {
            // Query only messages from current month onwards using selection filter
            String selection = "date >= ?";
            String[] selectionArgs = new String[] { String.valueOf(sinceTimestamp) };

            Log.i(TAG, "Executing ContentResolver query with date filter...");

            cursor = cr.query(
                uri,
                new String[] { "_id", "address", "body", "date" },
                selection,
                selectionArgs,
                "date DESC"
            );

            if (cursor == null) {
                Log.w(TAG, "SMS query returned null cursor!");
                return 0;
            }

            Log.i(TAG, "Cursor returned " + cursor.getCount() + " total SMS messages for this month");

            int addressIdx = cursor.getColumnIndex("address");
            int bodyIdx = cursor.getColumnIndex("body");
            int dateIdx = cursor.getColumnIndex("date");

            while (cursor.moveToNext() && count < limit) {
                totalRead++;
                String sender = addressIdx != -1 ? cursor.getString(addressIdx) : "";
                String body = bodyIdx != -1 ? cursor.getString(bodyIdx) : "";
                long date = dateIdx != -1 ? cursor.getLong(dateIdx) : 0;

                if (body == null || body.trim().isEmpty()) {
                    continue;
                }

                JSONObject parsed = SmsParser.parseSms(sender, body, date);
                if (parsed != null) {
                    try {
                        results.put(JSObject.fromJSONObject(parsed));
                        count++;
                        Log.d(TAG, "Parsed transaction #" + count + ": " + parsed.optString("vendor") + " " + parsed.optDouble("amount"));
                    } catch (Exception e) {
                        Log.w(TAG, "Error converting parsed SMS to JSObject", e);
                    }
                } else {
                    financialSkipped++;
                }
            }

            Log.i(TAG, "Scan summary: read=" + totalRead + " messages, parsed=" + count + " transactions, non-financial=" + financialSkipped);
        } catch (Exception e) {
            Log.e(TAG, "Error reading SMS cursor", e);
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return count;
    }
}
