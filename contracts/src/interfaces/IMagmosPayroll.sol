// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IMagmosPayroll
/// @notice The slice of MagmosPayroll consumed by the earned-wage-advance module.
interface IMagmosPayroll {
    /// @notice Live claimable for a stream: crystallized pendingBalance + accrual to now.
    function claimableAmount(bytes32 poolId, address employee) external view returns (uint256);

    /// @notice Settle already-earned pay early. Restricted to the wired advance module.
    function settleAdvance(bytes32 poolId, address employee, uint256 amount, address to)
        external
        returns (uint256 remainingClaimable);

    function getPool(bytes32 poolId)
        external
        view
        returns (
            address org,
            address token,
            uint256 totalDeposited,
            uint256 totalClaimed,
            uint256 balance,
            bool exists
        );

    function hasStream(bytes32 poolId, address employee) external view returns (bool);

    function employeesOf(bytes32 poolId) external view returns (address[] memory);
}
