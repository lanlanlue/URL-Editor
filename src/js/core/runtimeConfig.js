import { BUILD_MODE } from './buildMode.js';

const buildMode = BUILD_MODE === 'runtime' ? undefined : BUILD_MODE;
const runtimeMode =
  typeof globalThis !== 'undefined'
    ? globalThis.__URL_EDITOR_APP_MODE__
    : undefined;
const hostname =
  typeof window !== 'undefined' ? window.location.hostname : undefined;
const isProductionCloudHost = hostname === 'url-editor.ointw.com';
const isLocalDevelopmentHost =
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
const queryMode =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('appMode')
    : undefined;
const localDevelopmentCloudOverride =
  isLocalDevelopmentHost && (runtimeMode === 'cloud' || queryMode === 'cloud');

export const APP_MODE =
  buildMode === 'local' ||
  (!isProductionCloudHost && !localDevelopmentCloudOverride)
    ? 'local'
    : 'cloud';
export const CLOUD_ENABLED = APP_MODE === 'cloud';
export const CLOUD_ORIGIN = 'https://url-editor.ointw.com';

export default { APP_MODE, CLOUD_ENABLED, CLOUD_ORIGIN };
