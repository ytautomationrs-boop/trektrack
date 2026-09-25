import { Capacitor } from '@capacitor/core';
/** Native resize + dark system keyboard; keep browser page scale fixed when editing. */
export async function configureNativeExperience() {
 if (!Capacitor.isNativePlatform()) return;
 try {
  const {Keyboard,KeyboardStyle,KeyboardResize}=await import('@capacitor/keyboard');
  await Promise.all([Keyboard.setStyle({style:KeyboardStyle.Dark}),Keyboard.setResizeMode({mode:KeyboardResize.Native}),Keyboard.setAccessoryBarVisible({isVisible:false})]);
 } catch { /* Old installed shells still support standard native editing. */ }
}
