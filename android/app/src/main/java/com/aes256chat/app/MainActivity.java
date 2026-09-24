package com.aes256chat.app;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Sensitive content: block screenshots, screen recording and the recents thumbnail.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        // Capacitor enables remote WebView debugging for debuggable builds; that would expose the
        // unlocked app's JS context over USB (chrome://inspect). Never, in any build.
        WebView.setWebContentsDebuggingEnabled(false);
    }
}
