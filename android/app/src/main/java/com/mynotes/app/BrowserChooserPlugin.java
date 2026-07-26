package com.mynotes.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Parcelable;
import android.util.Log;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "BrowserChooser")
public class BrowserChooserPlugin extends Plugin {

    private static final String TAG = "BrowserChooserPlugin";

    // Supported Android browsers that render in-app Custom Tabs
    private static final String[] KNOWN_BROWSERS = new String[] {
        "com.brave.browser",
        "org.mozilla.firefox",
        "com.android.chrome",
        "com.sec.android.app.sbrowser",
        "com.microsoft.emmx",
        "com.opera.browser",
        "com.duckduckgo.mobile.android",
        "com.vivaldi.browser",
        "com.kiwibrowser.browser",
        "com.ucmobile.intl"
    };

    @PluginMethod
    public void openUrlWithChooser(PluginCall call) {
        String url = call.getString("url");
        String preferredPkg = call.getString("package");
        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        try {
            Uri targetUri = Uri.parse(url);

            // If a specific browser package (e.g. com.brave.browser or org.mozilla.firefox) is set, open it directly!
            if (preferredPkg != null && !preferredPkg.isEmpty() && !"auto".equalsIgnoreCase(preferredPkg)) {
                try {
                    CustomTabsIntent directTabs = new CustomTabsIntent.Builder().build();
                    directTabs.intent.setPackage(preferredPkg);
                    directTabs.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    directTabs.launchUrl(getContext(), targetUri);
                    call.resolve();
                    return;
                } catch (Exception e) {
                    Log.w(TAG, "Preferred package " + preferredPkg + " failed, falling back to system launcher", e);
                }
            }

            // Launch standard system CustomTabsIntent so Android's native "Just Once" / "Always" preference dialog works!
            CustomTabsIntent systemTabs = new CustomTabsIntent.Builder().build();
            systemTabs.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            systemTabs.launchUrl(getContext(), targetUri);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch Custom Tab", e);
            call.reject("Failed to launch Custom Tab: " + e.getMessage());
        }
    }
}
