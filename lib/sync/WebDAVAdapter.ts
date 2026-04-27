import { ISyncAdapter, BackupData, SyncAuthResult } from './ISyncAdapter';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { encode as btoa } from 'base-64';

const WEBDAV_CONFIG_KEY = '@miyo/sync/webdav_config';

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  try {
    const { getItemAsync } = await import('expo-secure-store');
    return getItemAsync(key);
  } catch {
    return AsyncStorage.getItem(key);
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    return AsyncStorage.setItem(key, value);
  }
  try {
    const { setItemAsync } = await import('expo-secure-store');
    return setItemAsync(key, value);
  } catch {
    return AsyncStorage.setItem(key, value);
  }
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    return AsyncStorage.removeItem(key);
  }
  try {
    const { deleteItemAsync } = await import('expo-secure-store');
    return deleteItemAsync(key);
  } catch {
    return AsyncStorage.removeItem(key);
  }
}

export class WebDAVAdapter implements ISyncAdapter {
  id = 'webdav';
  name = 'WebDAV';
  icon = 'server';

  private host = '';
  private username = '';
  private password = '';

  private getAuthHeader() {
    return 'Basic ' + btoa(`${this.username}:${this.password}`);
  }

  async configure(config: Record<string, string>): Promise<void> {
    this.host = config.host;
    this.username = config.username;
    this.password = config.password;
    await secureSet(WEBDAV_CONFIG_KEY, JSON.stringify(config));
  }

  async getConfig(): Promise<Record<string, string> | null> {
    const config = await secureGet(WEBDAV_CONFIG_KEY);
    if (!config) return null;
    const parsed = JSON.parse(config);
    this.host = parsed.host;
    this.username = parsed.username;
    this.password = parsed.password;
    return parsed;
  }

  async authenticate(): Promise<SyncAuthResult> {
    await this.getConfig();
    if (!this.host || !this.username || !this.password) {
      return { success: false, status: 'misconfigured', message: 'Enter your WebDAV host, username, and password first.' };
    }
    
    try {
      const testUrl = this.host.endsWith('/') ? this.host : this.host + '/';
      const response = await fetch(testUrl, {
        method: 'PROPFIND',
        headers: {
          'Authorization': this.getAuthHeader(),
          'Depth': '0',
        },
      });
      if (response.ok || response.status === 207) {
        return { success: true, status: 'success' };
      }
      return { success: false, status: 'error', message: 'WebDAV rejected the connection test.' };
    } catch {
      return { success: false, status: 'error', message: 'Could not reach the WebDAV server.' };
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const config = await this.getConfig();
    return !!(config && config.host && config.username && config.password);
  }

  async logout(): Promise<void> {
    this.host = '';
    this.username = '';
    this.password = '';
    await secureDelete(WEBDAV_CONFIG_KEY);
  }

  async uploadBackup(data: BackupData, fileName = 'miyo_backup.json'): Promise<boolean> {
    await this.getConfig();
    const targetUrl = (this.host.endsWith('/') ? this.host : this.host + '/') + fileName;
    
    try {
      const response = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
          'Authorization': this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      return response.ok || response.status === 201 || response.status === 204;
    } catch {
      return false;
    }
  }

  async downloadBackup(fileName = 'miyo_backup.json'): Promise<BackupData | null> {
    await this.getConfig();
    const targetUrl = (this.host.endsWith('/') ? this.host : this.host + '/') + fileName;
    
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Authorization': this.getAuthHeader(),
        },
      });
      
      if (response.ok) {
        return await response.json() as BackupData;
      }
      return null;
    } catch {
      return null;
    }
  }

  async getLastSyncTime(_fileName = 'miyo_backup.json'): Promise<string | null> {
    return null;
  }
}
