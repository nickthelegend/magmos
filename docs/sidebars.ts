import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "introduction",
    {
      type: "category",
      label: "Concepts",
      collapsed: false,
      items: [
        "concepts/streaming-payroll",
        "concepts/confidential-payroll",
        "concepts/pools-and-groups",
        "concepts/yield-layer",
        "concepts/claiming",
        "concepts/employee-vaults",
      ],
    },
    {
      type: "category",
      label: "Accept Payments",
      collapsed: false,
      items: [
        "sdk/overview",
        "sdk/quick-start",
        "sdk/api-keys",
        "sdk/payment-links",
      ],
    },
    "fees",
  ],
};

export default sidebars;
