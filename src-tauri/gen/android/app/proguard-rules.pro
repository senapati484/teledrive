# Tauri Android keep rules
-keep class app.tauri.** { *; }
-keep interface app.tauri.** { *; }
-keep class com.teledrive.app.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclasseswithmembernames class * {
    native <methods>;
}
-keepattributes *Annotation*
-keepattributes JavascriptInterface
-keepattributes EnclosingMethod
-keepattributes InnerClasses
-keepattributes Signature