package id.kurniapedia.ingatabsen

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator

class AlarmService : Service() {
    private var ring: Ringtone? = null
    private var vib: Vibrator? = null
    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, flags: Int, startId: Int): Int {
        if (i?.action == "STOP") { stopSelf(); return START_NOT_STICKY }
        val type = i?.getStringExtra("type") ?: "masuk"
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("alarm", "Alarm Presensi", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null); enableVibration(false)
        })
        val act = PendingIntent.getActivity(this, 2,
            Intent(this, AlarmActivity::class.java).putExtra("type", type).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, "alarm")
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Waktunya Presensi " + if (type == "masuk") "Masuk" else "Pulang")
            .setContentText("Ketuk untuk membuka")
            .setCategory(Notification.CATEGORY_ALARM).setOngoing(true)
            .setContentIntent(act).setFullScreenIntent(act, true).build()
        startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)

        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        ring = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)).apply {
            audioAttributes = attrs; isLooping = true; play()
        }
        vib = getSystemService(Vibrator::class.java)
        @Suppress("DEPRECATION")
        vib?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 1500, 500), 0), attrs)
        Handler(Looper.getMainLooper()).postDelayed({ stopSelf() }, 600000) // otomatis berhenti 10 menit
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        ring?.stop(); vib?.cancel()
        super.onDestroy()
    }
}
