import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
export type HealthStatus = { available: boolean; enabled: boolean; poolsEnabled?: boolean; syncing: boolean; todaySteps?: number; lastSyncedAt?: string; message?: string };
export const AppleHealth = registerPlugin<{
 setSession(value: {token: string | null; owner: string | null}): Promise<void>;
 connect(): Promise<HealthStatus>; connectPools(): Promise<HealthStatus>; disconnect(): Promise<HealthStatus>; connectPools(): Promise<HealthStatus>; refresh(): Promise<HealthStatus>; status(): Promise<HealthStatus>;
 addListener(name: 'changed', cb: (status: HealthStatus) => void): Promise<PluginListenerHandle>;
}>('ASTAHealth');
export function hasAppleHealth() { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('ASTAHealth'); }
export async function setHealthSession(token: string | null, owner: string | null) {
 if (hasAppleHealth()) try { await AppleHealth.setSession({token,owner}); } catch { /* Never block app startup. */ }
}
