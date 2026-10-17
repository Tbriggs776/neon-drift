package com.tylerbriggs.neondrift;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web layer whether it's running on Android TV, Google TV or
 * Fire TV, so src/native.js can switch on TV layout and remote navigation.
 */
@CapacitorPlugin(name = "TvMode")
public class TvModePlugin extends Plugin {

    @PluginMethod
    public void isTv(PluginCall call) {
        Context context = getContext();
        UiModeManager uiModeManager = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        boolean tvUiMode = uiModeManager != null
            && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        boolean leanback = context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);

        JSObject ret = new JSObject();
        ret.put("isTv", tvUiMode || leanback);
        call.resolve(ret);
    }
}
