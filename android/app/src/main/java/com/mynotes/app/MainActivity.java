package com.mynotes.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsTransactionPlugin.class);
        registerPlugin(FileSaverPlugin.class);
        registerPlugin(BrowserChooserPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

