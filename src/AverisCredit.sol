// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Modular, stateless credit engine. All inputs are caller-supplied;
/// the contract is pure computation with no storage. Owner of AverisFinancing
/// may deploy a new version and update the reference without touching vault or escrow.
contract AverisCredit {

    struct CreditParams {
        uint128 budget;           // job budget (6-decimal USDC)
        uint16  advanceRateBps;   // e.g. 2000 = 20%
        uint16  feeBps;           // e.g. 200  = 2%
        uint128 agentCreditLimit; // per-agent override; 0 = use protocolMaximum
        uint128 protocolMaximum;  // protocol-wide hard cap
        uint128 tierCap;          // Hood's cap for the job's adapter tier
        uint256 vaultLiquidity;   // vault.availableLiquidity() at call time
    }

    /// @notice Compute the maximum amount an agent may draw for a given job.
    /// Formula:
    ///   advanceCap  = budget × advanceRateBps / 10_000
    ///   solvencyCap = budget × 10_000 / (10_000 + feeBps)
    ///                 (ceil fee must fit inside the receivable)
    ///   agentCap    = agentCreditLimit > 0 ? agentCreditLimit : protocolMaximum
    ///   result      = min(advanceCap, solvencyCap, agentCap, protocolMaximum,
    ///                     tierCap, vaultLiquidity)
    function compute(CreditParams calldata p) external pure returns (uint256) {
        if (p.budget == 0 || p.advanceRateBps == 0) return 0;

        uint256 advanceCap  = uint256(p.budget) * p.advanceRateBps / 10_000;
        // Solvency cap: draw + ceil(draw × feeBps / 10_000) ≤ budget
        // Solving for draw: draw ≤ budget × 10_000 / (10_000 + feeBps)
        uint256 solvencyCap = uint256(p.budget) * 10_000 / (10_000 + uint256(p.feeBps));

        uint256 cap = advanceCap < solvencyCap ? advanceCap : solvencyCap;

        uint256 agentCap = p.agentCreditLimit > 0
            ? uint256(p.agentCreditLimit)
            : uint256(p.protocolMaximum);
        if (cap > agentCap) cap = agentCap;
        if (cap > uint256(p.protocolMaximum)) cap = uint256(p.protocolMaximum);
        if (cap > uint256(p.tierCap)) cap = uint256(p.tierCap);
        if (cap > p.vaultLiquidity) cap = p.vaultLiquidity;

        return cap;
    }
}
