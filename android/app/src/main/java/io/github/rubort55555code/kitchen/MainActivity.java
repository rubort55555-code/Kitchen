package io.github.rubort55555code.kitchen;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Свой модуль приложения: яркость экрана для оформления «по яркости»
        registerPlugin(BrightnessPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
