package com.teledrive.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    setupNotificationChannels()
    requestNotificationPermission()
  }

  private fun setupNotificationChannels() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      val transferChannel = NotificationChannel(
        "teledrive_transfers",
        "Transfers & Sync",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Shows upload, download, and device backup progress"
      }
      val alertsChannel = NotificationChannel(
        "teledrive_alerts",
        "TeleDrive Notifications",
        NotificationManager.IMPORTANCE_DEFAULT
      ).apply {
        description = "General notifications and storage alerts"
      }
      notificationManager?.createNotificationChannel(transferChannel)
      notificationManager?.createNotificationChannel(alertsChannel)
    }
  }

  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
      }
    }
  }

  override fun onPause() {
    super.onPause()
    // Resume timers so background tasks and long transfers continue processing
    try {
      android.webkit.WebView(this).resumeTimers()
    } catch (_: Exception) {}
  }
}
