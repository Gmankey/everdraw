import baseConfig from "./hardhat.config.js";

export default {
  ...baseConfig,
  networks: {
    ...baseConfig.networks,
    monadMainnet: {
      ...baseConfig.networks.monadMainnet,
      chainId: 143,
    },
  },
};
