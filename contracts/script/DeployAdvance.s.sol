// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MagmosPayroll} from "../src/MagmosPayroll.sol";
import {MagmosAdvance} from "../src/MagmosAdvance.sol";

/// @notice Ships Earned Wage Access to an existing Magmos deployment.
///
/// @dev `settleAdvance` is new bytecode, so MagmosPayroll must be redeployed — but the registry,
///      vault, yield vault and USDC token are untouched and are reused as-is. Pools and streams
///      live in the payroll, so the new payroll starts empty; re-run `scripts/seed-demo.sh`
///      afterwards to repopulate.
///
/// Usage:
///   export $(grep -v '^#' .env.deployer | xargs)
///   export MAGMOS_REGISTRY=0x...            # existing registry
///   forge script script/DeployAdvance.s.sol:DeployAdvance --rpc-url arc_testnet --broadcast -vvv
contract DeployAdvance is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address registry = vm.envAddress("MAGMOS_REGISTRY");

        vm.startBroadcast(pk);
        MagmosPayroll payroll = new MagmosPayroll(registry);
        MagmosAdvance advance = new MagmosAdvance(address(payroll), registry, deployer);
        // One-time, deployer-only wiring. After this the pairing is immutable.
        payroll.setAdvanceModule(address(advance));
        vm.stopBroadcast();

        console2.log("== Magmos EWA deployed on chain", block.chainid, "==");
        console2.log("MagmosPayroll (new):", address(payroll));
        console2.log("MagmosAdvance      :", address(advance));
        console2.log("registry (reused)  :", registry);
        console2.log("advanceModule wired:", payroll.advanceModule());

        string memory obj = "magmosAdvance";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "MagmosRegistry", registry);
        vm.serializeAddress(obj, "MagmosPayroll", address(payroll));
        string memory json = vm.serializeAddress(obj, "MagmosAdvance", address(advance));
        vm.writeJson(json, "./deployments/arc-testnet-advance.json");
        console2.log("wrote deployments/arc-testnet-advance.json");
    }
}
