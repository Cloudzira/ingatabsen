package id.kurniapedia.ingatabsen

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

object Scheduler {
    fun prefs(c: Context) = c.getSharedPreferences("ia", Context.MODE_PRIVATE)

    fun save(c: Context, j: JSONObject) {
        val d = j.optJSONArray("days")
        val days = (0 until (d?.length() ?: 0)).joinToString(",") { d!!.getInt(it).toString() }
        prefs(c).edit()
            .putString("tm", j.optString("timeMasuk", "07:00")).putString("tp", j.optString("timePulang", "15:00"))
            .putString("days", days.ifEmpty { "1,2,3,4,5,6" })
            .putInt("rc", j.optInt("repeatCount", 2)).putInt("ri", j.optInt("repeatInterval", 5))
            .putString("paused", j.optString("pausedUntil", "")).putString("link", j.optString("linkUrl", ""))
            .putString("cm", if (j.optBoolean("masukChecked")) j.optString("date") else "")
            .putString("cp", if (j.optBoolean("pulangChecked")) j.optString("date") else "")
            .apply()
        schedule(c)
    }

    fun markDone(c: Context, type: String) {
        prefs(c).edit().putString(if (type == "masuk") "cm" else "cp", LocalDate.now().toString()).putLong("snAt", 0L).apply()
        schedule(c)
    }

    fun snooze(c: Context, type: String, minutes: Int) {
        prefs(c).edit().putString("snType", type).putLong("snAt", System.currentTimeMillis() + minutes * 60000L).apply()
        schedule(c)
    }

    private fun pending(c: Context, type: String): PendingIntent =
        PendingIntent.getBroadcast(c, 1, Intent(c, AlarmReceiver::class.java).putExtra("type", type),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    // Menjadwalkan SATU alarm berikutnya; setelah berbunyi, receiver menjadwalkan yang selanjutnya.
    fun schedule(c: Context) {
        val p = prefs(c)
        val now = LocalDateTime.now()
        val days = p.getString("days", "1,2,3,4,5,6")!!.split(",").mapNotNull { it.toIntOrNull() }
        val paused = p.getString("paused", "")!!
        val rc = p.getInt("rc", 2)
        val ri = maxOf(1, p.getInt("ri", 5))
        var best: Pair<LocalDateTime, String>? = null
        for (off in 0..7) {
            val date = now.toLocalDate().plusDays(off.toLong())
            if ((date.dayOfWeek.value % 7) !in days) continue
            if (paused.isNotEmpty() && paused >= date.toString()) continue
            for ((type, key, ck) in listOf(Triple("masuk", "tm", "cm"), Triple("pulang", "tp", "cp"))) {
                if (p.getString(ck, "") == date.toString()) continue
                val (h, m) = p.getString(key, "07:00")!!.split(":").map { it.toInt() }
                for (k in 0..rc) {
                    val t = date.atTime(h, m).plusMinutes((k * ri).toLong())
                    if (t.isAfter(now.plusSeconds(1)) && (best == null || t.isBefore(best.first))) best = t to type
                }
            }
            if (best != null) break
        }
        val sa = p.getLong("snAt", 0L)
        val st = p.getString("snType", "")!!
        if (sa > System.currentTimeMillis() && st.isNotEmpty()) {
            val t = LocalDateTime.ofInstant(Instant.ofEpochMilli(sa), ZoneId.systemDefault())
            if (best == null || t.isBefore(best.first)) best = t to st
        }
        val am = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val b = best
        if (b == null) { am.cancel(pending(c, "masuk")); return }
        val at = b.first.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val show = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pending(c, b.second))
    }
}
