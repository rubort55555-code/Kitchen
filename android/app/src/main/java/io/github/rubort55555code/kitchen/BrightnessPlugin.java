package io.github.rubort55555code.kitchen;

import android.content.res.Resources;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Яркость экрана для оформления «по яркости»: положение ползунка яркости, 0…1.
 * С автояркостью ползунок сам следует за освещением.
 */
@CapacitorPlugin(name = "Brightness")
public class BrightnessPlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        try {
            int raw = Settings.System.getInt(getContext().getContentResolver(), Settings.System.SCREEN_BRIGHTNESS);
            int min = systemInt("config_screenBrightnessSettingMinimum", 1);
            int max = systemInt("config_screenBrightnessSettingMaximum", 255);
            // Некоторые телефоны хранят яркость в большем диапазоне, чем объявляют
            if (raw > max) {
                for (int m : new int[] {1023, 2047, 4095, 8191, 16383}) {
                    if (raw <= m) { max = m; break; }
                }
                if (raw > max) max = raw;
            }
            if (min >= max) min = 0;
            double linear = (double) (raw - min) / (max - min);
            JSObject r = new JSObject();
            r.put("value", toSlider(linear));
            r.put("raw", raw);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Яркость недоступна", e);
        }
    }

    private static int systemInt(String name, int def) {
        try {
            int id = Resources.getSystem().getIdentifier(name, "integer", "android");
            if (id != 0) {
                int v = Resources.getSystem().getInteger(id);
                if (v > 0) return v;
            }
        } catch (Exception ignored) {
        }
        return def;
    }

    /** С Android 9 ползунок яркости нелинейный: переводим значение яркости в положение ползунка. */
    static double toSlider(double linear) {
        double l = Math.max(0, Math.min(1, linear));
        if (Build.VERSION.SDK_INT < 28) return l;
        double val = l * 12;
        double r = 0.5, a = 0.17883277, b = 0.28466892, c = 0.55991073;
        double g = val <= 1 ? r * Math.sqrt(val) : a * Math.log(val - b) + c;
        return Math.max(0, Math.min(1, g));
    }
}
