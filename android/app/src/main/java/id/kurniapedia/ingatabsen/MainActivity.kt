package id.kurniapedia.ingatabsen

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.time.LocalDate

class Bridge(private val c: Context) {
    @JavascriptInterface fun sync(json: String) { try { Scheduler.save(c, JSONObject(json)) } catch (e: Exception) {} }
    @JavascriptInterface fun getState(): String {
        val p = Scheduler.prefs(c); val t = LocalDate.now().toString()
        return JSONObject().put("date", t).put("masukChecked", p.getString("cm", "") == t)
            .put("pulangChecked", p.getString("cp", "") == t).toString()
    }
}

class MainActivity : Activity() {
    private lateinit var web: WebView

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        try {
            if (Build.VERSION.SDK_INT >= 34 && !getSystemService(NotificationManager::class.java).canUseFullScreenIntent())
                startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
        } catch (e: Exception) {}
        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(Bridge(applicationContext), "AndroidBridge")
        val url = getString(R.string.app_url)
        val host = Uri.parse(url).host
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                if (r.url.host == host) return false
                startActivity(Intent(Intent.ACTION_VIEW, r.url)); return true
            }
        }
        web.loadUrl(url)
        Scheduler.schedule(this)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
}
