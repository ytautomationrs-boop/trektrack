import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';
const config: CapacitorConfig = {
  appId: 'com.asta.app', appName: 'ASTA', webDir: 'dist', backgroundColor: '#071a27',
  plugins: {
    Keyboard: { resize: KeyboardResize.Native, style: KeyboardStyle.Dark, autoBackdropColor: 'auto' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'banner', 'list'] },
  },
};
export default config;
