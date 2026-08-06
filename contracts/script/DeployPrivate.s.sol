// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MagmosPayroll} from "../src/MagmosPayroll.sol";
import {MagmosAdvance} from "../src/MagmosAdvance.sol";
import {MagmosEquityVault} from "../src/MagmosEquityVault.sol";
import {PythPriceRelay} from "../src/PythPriceRelay.sol";

/// @notice Ships the private-payroll release: MagmosPayroll with `settleSealed` (confidential
///         settlement of streamed pay), plus the oracle-priced equity rail.
///
/// @dev MagmosPayroll must be redeployed because `settleSealed`/`SEALER_ROLE` are new bytecode and
///      there is no proxy. MagmosAdvance is redeployed with it because `setAdvanceModule` is
///      one-time-forever and the new payroll's slot is unset. The registry, vault, yield vault and
///      USDC token are reused untouched.
///
/// Usage:
///   export $(grep -v '^#' .env.deployer | xargs)
///   export MAGMOS_REGISTRY=0x... MAGMOS_USDC=0x...
///   forge script script/DeployPrivate.s.sol:DeployPrivate --rpc-url arc_testnet --broadcast -vvv
contract DeployPrivate is Script {
    // Pyth's canonical AAPL/USD feed id. The vault reads the standard IPyth interface, so pointing
    // it at real Pyth later is an address swap with no code change.
    bytes32 constant AAPL_USD =
        0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address registry = vm.envAddress("MAGMOS_REGISTRY");
        address usdc = vm.envAddress("MAGMOS_USDC");

        vm.startBroadcast(pk);

        // Streaming payroll + confidential settlement.
        MagmosPayroll payroll = new MagmosPayroll(registry);
        MagmosAdvance advance = new MagmosAdvance(address(payroll), registry, deployer);
        payroll.setAdvanceModule(address(advance));

        // Equity rail: an on-chain Pyth-shaped relay, and a vault that prices RSU releases from it.
        // The deployer is the relayer (pushes Hermes prices) and the releaser (the payroll signer).
        PythPriceRelay oracle = new PythPriceRelay(deployer);
        MagmosEquityVault equity = new MagmosEquityVault(usdc, address(oracle), AAPL_USD, deployer);

        vm.stopBroadcast();

        console2.log("== Magmos private payroll deployed on chain", block.chainid, "==");
        console2.log("MagmosPayroll (settleSealed):", address(payroll));
        console2.log("MagmosAdvance               :", address(advance));
        console2.log("PythPriceRelay              :", address(oracle));
        console2.log("MagmosEquityVault           :", address(equity));
        console2.log("SEALER_ROLE bit             :", payroll.SEALER_ROLE());

        string memory obj = "magmosPrivate";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "MagmosRegistry", registry);
        vm.serializeAddress(obj, "MagmosPayroll", address(payroll));
        vm.serializeAddress(obj, "MagmosAdvance", address(advance));
        vm.serializeAddress(obj, "PythPriceRelay", address(oracle));
        string memory json = vm.serializeAddress(obj, "MagmosEquityVault", address(equity));
        vm.writeJson(json, "./deployments/arc-testnet-private.json");
        console2.log("wrote deployments/arc-testnet-private.json");
    }
}
