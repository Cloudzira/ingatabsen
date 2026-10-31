package id.kurniapedia.ingatabsen

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.time.LocalDate

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val type = i.getStringExtra("type") ?: "masuk"
        Scheduler.schedule(c) // jadwalkan alarm berikutnya lebih dulu
        val done = Scheduler.prefs(c).getString(if (type == "masuk") "cm" else "cp", "")
        if (done == LocalDate.now().toString()) return
        c.startForegroundService(Intent(c, AlarmService::class.java).putExtra("type", type))
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { Scheduler.schedule(c) }
}
