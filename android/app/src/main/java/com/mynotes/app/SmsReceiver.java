package com.mynotes.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;

public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "SmsReceiver";
    private static final String CHANNEL_ID = "transaction_alerts";
    private static final String CHANNEL_NAME = "Transaction Alerts";
    private static final String PREFS_NAME = "mynotes_sms_pending";
    private static final String PREFS_KEY = "pending_transactions";

    public interface SmsListener {
        void onSmsReceived(JSONObject smsData);
    }

    private static SmsListener listener;

    public static void setListener(SmsListener smsListener) {
        listener = smsListener;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) {
            return;
        }

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        try {
            Object[] pdus = (Object[]) bundle.get("pdus");
            String format = bundle.getString("format");

            if (pdus != null) {
                for (Object pdu : pdus) {
                    SmsMessage smsMessage;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        smsMessage = SmsMessage.createFromPdu((byte[]) pdu, format);
                    } else {
                        smsMessage = SmsMessage.createFromPdu((byte[]) pdu);
                    }

                    if (smsMessage != null) {
                        String sender = smsMessage.getDisplayOriginatingAddress();
                        String messageBody = smsMessage.getMessageBody();
                        long timestamp = smsMessage.getTimestampMillis();

                        JSONObject parsed = SmsParser.parseSms(sender, messageBody, timestamp);
                        if (parsed != null) {
                            if (listener != null) {
                                // App is in foreground — forward to JS via plugin
                                Log.i(TAG, "Forwarding SMS to JS listener (foreground)");
                                listener.onSmsReceived(parsed);
                            } else {
                                // App is in background — show notification + store for later
                                Log.i(TAG, "App in background — showing notification and storing transaction");
                                storePendingTransaction(context, parsed);
                                showTransactionNotification(context, parsed);
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in SmsReceiver.onReceive", e);
        }
    }

    /**
     * Store a parsed transaction in SharedPreferences so the app can pick it up on next launch.
     */
    private void storePendingTransaction(Context context, JSONObject parsed) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String existingJson = prefs.getString(PREFS_KEY, "[]");
            JSONArray arr = new JSONArray(existingJson);
            arr.put(parsed);
            prefs.edit().putString(PREFS_KEY, arr.toString()).apply();
            Log.i(TAG, "Stored pending transaction. Total pending: " + arr.length());
        } catch (Exception e) {
            Log.e(TAG, "Failed to store pending transaction", e);
        }
    }

    /**
     * Read and clear all pending transactions stored by background receiver.
     */
    public static JSONArray consumePendingTransactions(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String json = prefs.getString(PREFS_KEY, "[]");
            JSONArray arr = new JSONArray(json);
            if (arr.length() > 0) {
                prefs.edit().remove(PREFS_KEY).apply();
                Log.i(TAG, "Consumed " + arr.length() + " pending transactions from SharedPreferences");
            }
            return arr;
        } catch (Exception e) {
            Log.e(TAG, "Failed to consume pending transactions", e);
            return new JSONArray();
        }
    }

    /**
     * Show an Android system notification for a detected transaction.
     */
    private void showTransactionNotification(Context context, JSONObject parsed) {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // Create notification channel (required Android 8+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Alerts when a financial transaction is detected from SMS");
                channel.enableVibration(true);
                nm.createNotificationChannel(channel);
            }

            // Build notification content
            double amount = parsed.optDouble("amount", 0);
            String vendor = parsed.optString("vendor", "Transaction");
            String type = parsed.optString("type", "expense");
            String currencySymbol = "₹";
            String typeLabel = type.equals("inflow") ? "inflow" : "expense";

            String title = currencySymbol + String.format("%.0f", amount) + " " + typeLabel + " detected";
            String body = "From " + vendor + " — tap to review and add to your budget";

            // Tap intent: open the app
            Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (launchIntent == null) {
                launchIntent = new Intent();
            }
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, (int) System.currentTimeMillis(), launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setDefaults(NotificationCompat.DEFAULT_ALL);

            int notifId = (int) (System.currentTimeMillis() % Integer.MAX_VALUE);
            nm.notify(notifId, builder.build());
            Log.i(TAG, "Notification shown: " + title);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show notification", e);
        }
    }
}
