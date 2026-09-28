package media.alexlab.subsync2;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 9001;
    private static final int NATIVE_SAVE_REQUEST = 9002;
    private static final String ALLOWED_HOST = "zuzuitu.github.io";
    private static final String ALLOWED_PATH_PREFIX = "/subsync-web-enhanced/";

    private final Object nativeSaveLock = new Object();

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private String pendingNativeSaveSession;
    private String activeNativeSaveSession;
    private Uri activeNativeSaveUri;
    private OutputStream activeNativeSaveStream;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(
                settings.getUserAgentString()
                        + " SubSync2Android/"
                        + BuildConfig.VERSION_NAME
        );

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.addJavascriptInterface(new SubSyncAndroidBridge(), "SubSyncAndroid");
        webView.setWebViewClient(new SubSyncWebViewClient());
        webView.setWebChromeClient(new SubSyncWebChromeClient());

        setContentView(webView);
        webView.requestFocus();

        if (savedInstanceState == null) {
            webView.loadUrl(withAndroidMarker(BuildConfig.SUBSYNC2_URL));
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private String withAndroidMarker(String baseUrl) {
        Uri uri = Uri.parse(baseUrl);
        return uri.buildUpon()
                .appendQueryParameter("platform", "android")
                .appendQueryParameter("shell", BuildConfig.VERSION_NAME)
                .build()
                .toString();
    }

    private boolean isSubSyncUrl(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        String path = uri.getPath();
        return "https".equalsIgnoreCase(scheme)
                && ALLOWED_HOST.equalsIgnoreCase(host)
                && path != null
                && path.startsWith(ALLOWED_PATH_PREFIX);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "Nu există o aplicație pentru acest link.", Toast.LENGTH_LONG).show();
        }
    }

    private void launchFilePicker(ValueCallback<Uri[]> callback) {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
        }
        pendingFileCallback = callback;

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // Deliberately unrestricted: MKV must never be greyed out by a MIME/extension filter.
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);

        try {
            startActivityForResult(intent, FILE_CHOOSER_REQUEST);
        } catch (ActivityNotFoundException error) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
            Toast.makeText(
                    this,
                    "Nu am găsit selectorul de fișiere Android.",
                    Toast.LENGTH_LONG
            ).show();
        }
    }

    private void launchNativeSave(String sessionId, String suggestedName, String mimeType) {
        abortNativeSaveInternal(false);
        pendingNativeSaveSession = sessionId;

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(
                mimeType == null || mimeType.trim().isEmpty()
                        ? "application/octet-stream"
                        : mimeType
        );
        intent.putExtra(
                Intent.EXTRA_TITLE,
                suggestedName == null || suggestedName.trim().isEmpty()
                        ? "SubSync2-audio"
                        : suggestedName
        );
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);

        try {
            startActivityForResult(intent, NATIVE_SAVE_REQUEST);
        } catch (ActivityNotFoundException error) {
            pendingNativeSaveSession = null;
            postNativeSaveEvent("subsync2-native-save-error", sessionId,
                    "Nu am găsit selectorul Android pentru salvare.");
        }
    }

    private void prepareNativeSaveTarget(int resultCode, Intent data) {
        String sessionId = pendingNativeSaveSession;
        pendingNativeSaveSession = null;
        if (sessionId == null) {
            return;
        }

        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            postNativeSaveEvent("subsync2-native-save-cancelled", sessionId, null);
            return;
        }

        Uri uri = data.getData();
        try {
            int flags = data.getFlags() & (
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
            if ((flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0) {
                try {
                    getContentResolver().takePersistableUriPermission(uri, flags);
                } catch (SecurityException ignored) {
                    // Some providers only grant the transient permission; that is enough for this save.
                }
            }

            OutputStream stream = getContentResolver().openOutputStream(uri, "wt");
            if (stream == null) {
                throw new IOException("Android nu a deschis destinația pentru scriere.");
            }

            synchronized (nativeSaveLock) {
                activeNativeSaveSession = sessionId;
                activeNativeSaveUri = uri;
                activeNativeSaveStream = stream;
            }
            postNativeSaveEvent("subsync2-native-save-ready", sessionId, null);
        } catch (Exception error) {
            postNativeSaveEvent(
                    "subsync2-native-save-error",
                    sessionId,
                    error.getMessage() == null ? "Nu am putut deschide fișierul pentru salvare." : error.getMessage()
            );
        }
    }

    private void postNativeSaveEvent(String type, String sessionId, String message) {
        if (webView == null) {
            return;
        }

        String payload = "{"
                + "\"type\":" + JSONObject.quote(type)
                + ",\"sessionId\":" + JSONObject.quote(sessionId)
                + (message == null ? "" : ",\"message\":" + JSONObject.quote(message))
                + "}";

        String script = "(function(m){"
                + "function send(w){try{w.postMessage(m,'*');"
                + "for(var i=0;i<w.frames.length;i++){send(w.frames[i]);}}catch(e){}}"
                + "send(window);"
                + "})(" + payload + ");";

        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private void abortNativeSaveInternal(boolean deletePartial) {
        Uri uri;
        synchronized (nativeSaveLock) {
            uri = activeNativeSaveUri;
            if (activeNativeSaveStream != null) {
                try {
                    activeNativeSaveStream.close();
                } catch (IOException ignored) {
                }
            }
            activeNativeSaveStream = null;
            activeNativeSaveSession = null;
            activeNativeSaveUri = null;
        }
        if (deletePartial && uri != null) {
            try {
                getContentResolver().delete(uri, null, null);
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == NATIVE_SAVE_REQUEST) {
            prepareNativeSaveTarget(resultCode, data);
            return;
        }

        if (requestCode != FILE_CHOOSER_REQUEST) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }

        ValueCallback<Uri[]> callback = pendingFileCallback;
        pendingFileCallback = null;
        if (callback == null) {
            return;
        }

        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            callback.onReceiveValue(null);
            return;
        }

        Uri uri = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        } catch (SecurityException ignored) {
            // Some providers grant only the transient read permission. WebView can still use it.
        }
        callback.onReceiveValue(new Uri[]{uri});
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        abortNativeSaveInternal(false);
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("SubSyncAndroid");
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class SubSyncAndroidBridge {
        @JavascriptInterface
        public String requestSave(String suggestedName, String mimeType) {
            String sessionId = UUID.randomUUID().toString();
            runOnUiThread(() -> launchNativeSave(sessionId, suggestedName, mimeType));
            return sessionId;
        }

        @JavascriptInterface
        public boolean writeSaveChunk(String sessionId, String base64Chunk) {
            synchronized (nativeSaveLock) {
                if (activeNativeSaveStream == null
                        || activeNativeSaveSession == null
                        || !activeNativeSaveSession.equals(sessionId)) {
                    return false;
                }
                try {
                    byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                    activeNativeSaveStream.write(bytes);
                    return true;
                } catch (Exception error) {
                    postNativeSaveEvent(
                            "subsync2-native-save-error",
                            sessionId,
                            error.getMessage() == null ? "Scrierea fișierului Android a eșuat." : error.getMessage()
                    );
                    return false;
                }
            }
        }

        @JavascriptInterface
        public boolean finishSave(String sessionId) {
            synchronized (nativeSaveLock) {
                if (activeNativeSaveStream == null
                        || activeNativeSaveSession == null
                        || !activeNativeSaveSession.equals(sessionId)) {
                    return false;
                }
                try {
                    activeNativeSaveStream.flush();
                    activeNativeSaveStream.close();
                    activeNativeSaveStream = null;
                    activeNativeSaveSession = null;
                    activeNativeSaveUri = null;
                    return true;
                } catch (IOException error) {
                    return false;
                }
            }
        }

        @JavascriptInterface
        public void abortSave(String sessionId) {
            synchronized (nativeSaveLock) {
                if (activeNativeSaveSession == null || !activeNativeSaveSession.equals(sessionId)) {
                    return;
                }
            }
            abortNativeSaveInternal(true);
        }
    }

    private final class SubSyncWebChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
        ) {
            launchFilePicker(filePathCallback);
            return true;
        }
    }

    private final class SubSyncWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isSubSyncUrl(uri)) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isSubSyncUrl(uri)) {
                return false;
            }
            openExternal(uri);
            return true;
        }
    }
}
