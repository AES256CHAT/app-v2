package com.aes256chat.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONObject;

/**
 * Receives what other apps hand to us: ACTION_SEND (share sheet: text or a file) and
 * ACTION_PROCESS_TEXT (text selection toolbar). Nothing is stored here; the payload is
 * passed once to the web layer, which decrypts it or parks it until the vault is unlocked.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    private static final long MAX_BYTES = 26L * 1024 * 1024;
    private JSObject pending;

    @Override
    public void load() {
        pending = extract(getActivity().getIntent());
        consume(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        JSObject item = extract(intent);
        consume(intent);
        if (item != null) {
            pending = item;
            notifyListeners("shareReceived", item, true);
        }
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject r = new JSObject();
        r.put("item", pending == null ? JSONObject.NULL : pending);
        pending = null;
        call.resolve(r);
    }

    /** Strip the payload so a configuration change cannot re-deliver it. */
    private void consume(Intent intent) {
        if (intent == null) return;
        intent.setAction(Intent.ACTION_MAIN);
        intent.replaceExtras(new Bundle());
        intent.setData(null);
    }

    private JSObject extract(Intent intent) {
        if (intent == null || intent.getAction() == null) return null;
        String action = intent.getAction();
        try {
            if (Intent.ACTION_SEND.equals(action)) {
                Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) return readFile(stream);
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (text != null) return textItem(text);
            } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
                CharSequence t = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
                if (t != null) return textItem(t.toString());
            }
        } catch (Exception ignored) {
            // malformed intent from another app: ignore silently
        }
        return null;
    }

    private JSObject textItem(String text) {
        JSObject o = new JSObject();
        o.put("text", text);
        return o;
    }

    private JSObject readFile(Uri uri) throws Exception {
        String name = "shared.aes256";
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0 && c.getString(i) != null) name = c.getString(i);
            }
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) return null; // too large: silently ignore
                out.write(buf, 0, n);
            }
            JSObject o = new JSObject();
            o.put("fileName", name);
            o.put("fileBase64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            return o;
        }
    }
}
