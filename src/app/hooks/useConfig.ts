import { useContext } from "react";
import { ConfigContext } from "@/app/providers/ConfigProvider";
import type { ConfigContextValue } from "@/app/providers/ConfigProvider.types";

/**
 * Reads the effective configuration and its load metadata.
 *
 * @returns The configuration context value.
 * @throws When called outside a `ConfigProvider`.
 */
export function useConfig(): ConfigContextValue {
  const value = useContext(ConfigContext);

  if (!value) {
    throw new Error("useConfig must be used within a ConfigProvider.");
  }

  return value;
}
