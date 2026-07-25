package com.mynotes.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "FileSaver",
    permissions = {
        @Permission(
            strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.READ_EXTERNAL_STORAGE },
            alias = "storage"
        )
    }
)
public class FileSaverPlugin extends Plugin {

    private static final String TAG = "FileSaverPlugin";

    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName", "export.xlsx");
        String base64Data = call.getString("base64Data");
        String mimeType = call.getString("mimeType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("Base64 data is empty");
            return;
        }

        // Clean base64 header if present (e.g. data:application/...;base64,)
        if (base64Data.contains(",")) {
            base64Data = base64Data.substring(base64Data.indexOf(",") + 1);
        }

        // On Android <= 9 (API < 29), check storage permission
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            boolean hasPermission = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
            if (!hasPermission) {
                Log.i(TAG, "Requesting WRITE_EXTERNAL_STORAGE permission for Android < 10...");
                requestPermissionForAlias("storage", call, "storagePermissionCallback");
                return;
            }
        }

        performSaveAndShare(call, fileName, base64Data, mimeType);
    }

    @PermissionCallback
    public void storagePermissionCallback(PluginCall call) {
        if (call == null) return;
        String fileName = call.getString("fileName", "export.xlsx");
        String base64Data = call.getString("base64Data");
        String mimeType = call.getString("mimeType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        if (base64Data != null && !base64Data.isEmpty()) {
            if (base64Data.contains(",")) {
                base64Data = base64Data.substring(base64Data.indexOf(",") + 1);
            }
            performSaveAndShare(call, fileName, base64Data, mimeType);
        } else {
            call.reject("Base64 data is empty after permission callback");
        }
    }

    private void performSaveAndShare(PluginCall call, String fileName, String base64Data, String mimeType) {
        try {
            byte[] fileBytes = Base64.decode(base64Data, Base64.DEFAULT);
            boolean savedToDownloads = false;
            Uri contentUri = null;

            // 1. Save to Android Public Downloads folder via MediaStore (Android 10+) or Direct File (Android 9-)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues contentValues = new ContentValues();
                contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                contentValues.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                contentValues.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues);
                if (uri != null) {
                    OutputStream out = resolver.openOutputStream(uri);
                    if (out != null) {
                        out.write(fileBytes);
                        out.flush();
                        out.close();
                        savedToDownloads = true;
                        contentUri = uri;
                        Log.i(TAG, "Successfully saved file to MediaStore Downloads: " + uri);
                    }
                }
            } else {
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs();
                }
                File destFile = new File(downloadsDir, fileName);
                FileOutputStream fos = new FileOutputStream(destFile);
                fos.write(fileBytes);
                fos.flush();
                fos.close();
                savedToDownloads = true;
                Log.i(TAG, "Successfully saved file to Legacy Downloads: " + destFile.getAbsolutePath());
            }

            // 2. Also save to cache dir & generate FileProvider URI for Intent sharing / opening
            File cacheDir = getContext().getCacheDir() != null ? getContext().getCacheDir() : getContext().getFilesDir();
            File shareFile = new File(cacheDir, fileName);
            FileOutputStream cacheFos = new FileOutputStream(shareFile);
            cacheFos.write(fileBytes);
            cacheFos.flush();
            cacheFos.close();

            String authority = getContext().getPackageName() + ".fileprovider";
            Uri shareUri = FileProvider.getUriForFile(getContext(), authority, shareFile);

            // 3. Open System Share / Open-With Intent so the user can open in Excel, Sheets, Drive, WhatsApp, etc.
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_STREAM, shareUri);
            intent.putExtra(Intent.EXTRA_SUBJECT, fileName);
            intent.putExtra(Intent.EXTRA_TEXT, "Exported from myNotes: " + fileName);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(intent, "Open / Save " + fileName);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("savedToDownloads", savedToDownloads);
            res.put("fileName", fileName);
            call.resolve(res);

        } catch (Exception e) {
            Log.e(TAG, "Failed to save file", e);
            call.reject("Failed to save file: " + e.getMessage());
        }
    }
}
