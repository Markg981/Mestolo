package com.markg981.mestolo;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Mestolo Android shell.
 * Handles "Share → Mestolo" from other apps (e.g. a recipe link shared from Chrome):
 * the shared text is passed to the site's /share/native page in the URL fragment (never sent to
 * the server, so it stays out of logs and Referer), which opens the link import or the text import.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShare(intent);
    }

    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty() || getBridge() == null) return;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String base = getBridge().getServerUrl();
        if (base == null) return;
        if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        final String target = base + "/share/native#text=" +Uri.encode(text) + (subject != null ? "&title=" + Uri.encode(subject) : "");
        // Consume the intent so a later configuration change does not re-open the import
        intent.setAction(Intent.ACTION_MAIN);
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(target));
    }
}
