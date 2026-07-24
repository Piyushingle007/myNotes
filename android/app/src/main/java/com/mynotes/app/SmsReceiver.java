package com.mynotes.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import org.json.JSONObject;

public class SmsReceiver extends BroadcastReceiver {

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
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                        smsMessage = SmsMessage.createFromPdu((byte[]) pdu, format);
                    } else {
                        smsMessage = SmsMessage.createFromPdu((byte[]) pdu);
                    }

                    if (smsMessage != null) {
                        String sender = smsMessage.getDisplayOriginatingAddress();
                        String messageBody = smsMessage.getMessageBody();
                        long timestamp = smsMessage.getTimestampMillis();

                        JSONObject parsed = SmsParser.parseSms(sender, messageBody, timestamp);
                        if (parsed != null && listener != null) {
                            listener.onSmsReceived(parsed);
                        }
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
