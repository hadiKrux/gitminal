import manifest from "../../package.json";

/** Package name read from `package.json`, used by the registry check and install command. */
export const APP_PACKAGE_NAME: string = manifest.name;

/** Running version read from `package.json`, shown on the splash and compared with the registry. */
export const APP_VERSION: string = manifest.version;
