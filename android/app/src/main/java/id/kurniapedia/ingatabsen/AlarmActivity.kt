package id.kurniapedia.ingatabsen

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class AlarmActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setShowWhenLocked(true); setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val type = intent.getStringExtra("type") ?: "masuk"
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setBackgroundColor(0xFFB91C1C.toInt()); setPadding(48, 48, 48, 48)
        }
        fun label(t: String, sp: Float) = TextView(this).apply { text = t; textSize = sp; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
        fun button(t: String, f: () -> Unit) = Button(this).apply { text = t; setOnClickListener { f() } }
        root.addView(label("⏰", 64f))
        root.addView(label("Waktunya Presensi " + if (type == "masuk") "Masuk" else "Pulang", 26f))
        root.addView(label("Getar dan suara aktif sampai Anda menekan tombol.\n", 14f))
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        root.addView(button("Buka Presensi Sekarang") {
            stopRing()
            val link = Scheduler.prefs(this).getString("link", "") ?: ""
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link))) } catch (e: Exception) { startActivity(Intent(this, MainActivity::class.java)) }
            finish()
        }, lp)
        root.addView(button("Sudah Absen") { Scheduler.markDone(this, type); stopRing(); finish() }, lp)
        root.addView(button("Matikan Getar") { stopRing(); finish() }, lp)
        root.addView(button("Tunda 10 menit") { Scheduler.snooze(this, type, 10); stopRing(); finish() }, lp)
        setContentView(root)
    }

    private fun stopRing() { startService(Intent(this, AlarmService::class.java).setAction("STOP")) }
}
