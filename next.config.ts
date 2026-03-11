import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Required for Lingui: the SWC plugin transforms <Trans> and t`` macros
    // from @lingui/react/macro and @lingui/core/macro into runtime calls
    // at compile time. Without this, macros are not transformed and will
    // throw runtime errors.
    swcPlugins: [["@lingui/swc-plugin", {}]],
  },
};

export default nextConfig;
