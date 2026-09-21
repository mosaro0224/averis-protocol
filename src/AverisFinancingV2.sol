// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}                from "./interfaces/IERC20.sol";
import {SafeTransfer}          from "./lib/SafeTransfer.sol";
import {IJobAdapter}           from "./interfaces/IJobAdapter.sol";
import {AverisAdapterRegistry} from "./AverisAdapterRegistry.sol";
import {AverisCredit}          from "./AverisCredit.sol";
import {AverisPoolFactory}     from "./AverisPoolFactory.sol";
import {AverisHood}            from "./AverisHood.sol";
import {AverisJobPool}         from "./AverisJobPool.sol";
import {AverisReserve}         from "./AverisReserve.sol";

interface IAverisVaultV2 {
    function availableLiquidity() external view returns (uint256);
    function deploy(address recipient, uint256 amount) external;
    function receiveRepayment(uint256 principal, uint256 fee) external;
    function writeOff(uint256 principal) external;
}

/// @notice Averis V2 financing contract.
///
/// Key changes from V1:
///   • draw() deploys capital to a job-specific AverisJobPool, not the agent wallet.
///   • draw() validates the job via a registered IJobAdapter (pluggable external protocols).
///   • draw() calls AverisHood.checkAndRecord() before any fund movement.
///   • OBLIGATION mode: agent signs an EIP-712 RepaymentObligation at draw time.
///   • _closeLoss() recovers unspent pool capital before writing off net loss.
///   • finalizeDefault() releases Hood exposure after default accounting.
///
/// Unchanged from V1:
///   • receivePayout() — ReceivableRouter still calls this on settlement.
///   • Vault accounting (deploy, receiveRepayment, writeOff).
///   • One position per jobId enforced by ExistingPosition check.
///   • Principal-before-fee repayment ordering.
contract AverisFinancingV2 {
    using SafeTransfer for IERC20;

    // ── Errors ────────────────────────────────────────────────────────────────
    error Unauthorized();
    error IneligibleJob();
    error ExistingPosition();
    error InvalidAmount();
    error NotActive();
    error InvalidSignature();
    error ObligationExpired();
    error NonceReused();
    error AdapterInactive();
    error Reentrancy();

    // ── Reentrancy guard ──────────────────────────────────────────────────────
    uint256 private _unlocked = 1;
    modifier nonReentrant() {
        if (_unlocked != 1) revert Reentrancy();
        _unlocked = 2;
        _;
        _unlocked = 1;
    }

    // ── Position states ───────────────────────────────────────────────────────
    enum Status { NONE, ACTIVE, REPAID, PARTIALLY_RECOVERED, DEFAULTED, EXPIRED }

    struct Position {
        address agent;
        address poolAddress;   // AverisJobPool address
        uint128 principal;
        uint128 fee;
        uint128 principalRepaid;
        uint128 feeRepaid;
        uint64  expiry;
        Status  status;
        IJobAdapter.AdapterTier tier;
        IJobAdapter.RepayMode   repayMode;
    }

    // ── EIP-712 obligation ────────────────────────────────────────────────────
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant OBLIGATION_TYPEHASH = keccak256(
        "RepaymentObligation(address agent,address protocol,uint256 jobId,"
        "uint128 principal,uint128 fee,uint64 expiry,uint256 nonce,uint256 chainId)"
    );
    mapping(address => uint256) public obligationNonce; // per-agent monotonic

    // ── Fee split (Option B: 70% LP / 20% treasury / 10% reserve) ───────────
    /// @dev All three bps values must sum to 10_000. Enforced in constructor.
    struct FeeSplit {
        uint16 lpBps;        // share credited to vault (LP yield)
        uint16 treasuryBps;  // share sent to protocol treasury
        uint16 reserveBps;   // share deposited into AverisReserve
    }

    // ── Immutables ────────────────────────────────────────────────────────────
    IERC20                  public immutable asset;
    IAverisVaultV2          public immutable vault;
    AverisAdapterRegistry   public immutable registry;
    AverisCredit            public immutable credit;
    address                 public immutable router;   // ReceivableRouter
    AverisPoolFactory       public immutable factory;
    AverisHood              public immutable hood;
    address                 public immutable owner;
    AverisReserve           public immutable reserveFund;
    FeeSplit                public             feeSplit;  // mutable — owner can adjust bps
    address                 public             treasury;  // mutable — supports multisig migration

    // ── Mutable parameters ────────────────────────────────────────────────────
    uint16  public advanceRateBps;
    uint16  public feeBps;
    uint128 public protocolMaximum;
    uint128 public defaultPerTxLimit;  // default spending limit per pool.spend() call
    mapping(address => uint128) public creditLimit;

    // Default allowed recipients for new pools (agent can add more via addPoolRecipient)
    // Empty by default — agent's own address is added at draw time
    mapping(uint256 => Position) public positions;

    // ── Events ────────────────────────────────────────────────────────────────
    event Drawn(
        uint256 indexed jobId,
        address indexed agent,
        uint256 principal,
        uint256 fee,
        address pool,
        IJobAdapter.AdapterTier tier,
        IJobAdapter.RepayMode repayMode
    );
    event Repaid(uint256 indexed jobId, uint256 principal, uint256 fee);
    event Defaulted(uint256 indexed jobId, Status status, uint256 principalLoss);
    event PoolRecipientAdded(uint256 indexed jobId, address recipient);
    event TreasuryUpdated(address indexed previous, address indexed next);
    event FeeSplitUpdated(uint16 lpBps, uint16 treasuryBps, uint16 reserveBps);
    event FeeDistributed(uint256 indexed jobId, uint256 lpFee, uint256 treasuryFee, uint256 reserveFee);

    constructor(
        IERC20                asset_,
        IAverisVaultV2        vault_,
        AverisAdapterRegistry registry_,
        AverisCredit          credit_,
        address               router_,
        AverisPoolFactory     factory_,
        AverisHood            hood_,
        address               owner_,
        uint16                advanceRateBps_,
        uint16                feeBps_,
        uint128               protocolMaximum_,
        uint128               defaultPerTxLimit_,
        address               treasury_,
        AverisReserve         reserveFund_,
        FeeSplit memory       feeSplit_
    ) {
        require(
            router_ != address(0) && owner_ != address(0) &&
            treasury_ != address(0) && address(reserveFund_) != address(0) &&
            advanceRateBps_ <= 10_000 && feeBps_ <= 10_000,
            "invalid params"
        );
        require(
            uint256(feeSplit_.lpBps) + feeSplit_.treasuryBps + feeSplit_.reserveBps == 10_000,
            "split != 100%"
        );
        asset             = asset_;
        vault             = vault_;
        registry          = registry_;
        credit            = credit_;
        router            = router_;
        factory           = factory_;
        hood              = hood_;
        owner             = owner_;
        advanceRateBps    = advanceRateBps_;
        feeBps            = feeBps_;
        protocolMaximum   = protocolMaximum_;
        defaultPerTxLimit = defaultPerTxLimit_;
        treasury          = treasury_;
        reserveFund       = reserveFund_;
        feeSplit          = feeSplit_;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("AverisFinancingV2"),
            keccak256("2"),
            block.chainid,
            address(this)
        ));
    }

    modifier onlyOwner()  { if (msg.sender != owner)  revert Unauthorized(); _; }
    modifier onlyRouter() { if (msg.sender != router) revert Unauthorized(); _; }

    // ── Owner configuration ───────────────────────────────────────────────────

    function setParameters(uint16 ar, uint16 f, uint128 m, uint128 perTx) external onlyOwner {
        if (ar > 10_000 || f > 10_000) revert InvalidAmount();
        advanceRateBps    = ar;
        feeBps            = f;
        protocolMaximum   = m;
        defaultPerTxLimit = perTx;
    }

    function setCreditLimit(address agent, uint128 limit) external onlyOwner {
        creditLimit[agent] = limit;
    }

    /// @notice Migrate treasury to a multisig before mainnet.
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "zero treasury");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Adjust fee split bps. All three values must still sum to 10_000.
    function setFeeSplit(uint16 lpBps_, uint16 treasuryBps_, uint16 reserveBps_) external onlyOwner {
        require(uint256(lpBps_) + treasuryBps_ + reserveBps_ == 10_000, "split != 100%");
        feeSplit = FeeSplit(lpBps_, treasuryBps_, reserveBps_);
        emit FeeSplitUpdated(lpBps_, treasuryBps_, reserveBps_);
    }

    // ── Max advance (public view) ─────────────────────────────────────────────

    /// @notice Maximum drawable amount for a job given current protocol state.
    /// Returns 0 if the job is ineligible or the adapter is inactive.
    function maxAdvance(address protocol, uint256 adapterId, uint256 jobId) public view returns (uint256) {
        if (!registry.isActive(protocol, adapterId)) return 0;
        AverisAdapterRegistry.AdapterConfig memory cfg = registry.getAdapter(protocol, adapterId);
        IJobAdapter adapter = IJobAdapter(cfg.adapter);

        IJobAdapter.JobView memory jv;
        try adapter.getJob(jobId) returns (IJobAdapter.JobView memory v) {
            jv = v;
        } catch {
            return 0;
        }

        if (jv.state != IJobAdapter.JobState.FUNDED &&
            jv.state != IJobAdapter.JobState.SUBMITTED) return 0;
        if (jv.token != address(asset))              return 0;
        if (jv.expiry <= block.timestamp)            return 0;

        uint128 tierCap_ = hood.tierCapFor(cfg.tier);

        return credit.compute(AverisCredit.CreditParams({
            budget:           jv.budget,
            advanceRateBps:   advanceRateBps,
            feeBps:           feeBps,
            agentCreditLimit: creditLimit[jv.agent],
            protocolMaximum:  protocolMaximum,
            tierCap:          tierCap_,
            vaultLiquidity:   vault.availableLiquidity()
        }));
    }

    // ── Draw ──────────────────────────────────────────────────────────────────

    /// @notice Draw financing for a job. Creates a controlled spending pool.
    /// For LIEN mode: payoutReceiver must already be the router.
    /// For OBLIGATION mode: agent must provide a valid EIP-712 signed obligation.
    ///
    /// @param protocol    Source protocol/escrow address.
    /// @param adapterId   Adapter ID in the registry (0 for single-adapter protocols).
    /// @param jobId       Job identifier on the source protocol.
    /// @param amount      Amount to draw (must be ≤ maxAdvance).
    /// @param obligationSig EIP-712 RepaymentObligation signature — required for OBLIGATION
    ///                    mode, ignored for LIEN mode (pass empty bytes).
    /// @param recipients  Initial allowed spending recipients for the pool.
    ///                    Agent's own address is always added automatically.
    function draw(
        address   protocol,
        uint256   adapterId,
        uint256   jobId,
        uint128   amount,
        bytes calldata obligationSig,
        address[] calldata recipients
    ) external nonReentrant {
        // 1. No double-financing
        if (positions[jobId].status != Status.NONE) revert ExistingPosition();

        // 2. Resolve adapter
        AverisAdapterRegistry.AdapterConfig memory cfg = registry.getAdapter(protocol, adapterId);
        if (!cfg.active) revert AdapterInactive();
        IJobAdapter adapter = IJobAdapter(cfg.adapter);

        // 3. Get canonical job view
        IJobAdapter.JobView memory jv = adapter.getJob(jobId);

        // 4. Validate job eligibility
        if (msg.sender != jv.agent)                  revert IneligibleJob(); // caller must be provider
        if (jv.token != address(asset))              revert IneligibleJob();
        if (jv.state != IJobAdapter.JobState.FUNDED &&
            jv.state != IJobAdapter.JobState.SUBMITTED) revert IneligibleJob();
        if (jv.expiry <= block.timestamp)            revert IneligibleJob();
        if (amount == 0)                             revert IneligibleJob();

        // 5. Repayment mode enforcement
        IJobAdapter.RepayMode repayMode = jv.repayMode;
        if (repayMode == IJobAdapter.RepayMode.LIEN) {
            // Lien must already be set — payout receiver must be the router
            if (jv.payoutReceiver != router) revert IneligibleJob();
        } else {
            // OBLIGATION mode: require valid EIP-712 signed obligation
            _verifyObligation(jv.agent, protocol, jobId, amount, _ceilFee(amount), jv.expiry, obligationSig);
        }

        // 6. Credit cap check
        uint128 tierCap_ = hood.tierCapFor(cfg.tier);
        uint256 max = credit.compute(AverisCredit.CreditParams({
            budget:           jv.budget,
            advanceRateBps:   advanceRateBps,
            feeBps:           feeBps,
            agentCreditLimit: creditLimit[jv.agent],
            protocolMaximum:  protocolMaximum,
            tierCap:          tierCap_,
            vaultLiquidity:   vault.availableLiquidity()
        }));
        if (amount > max) revert IneligibleJob();

        // 7. Fee + solvency check
        uint128 fee = _ceilFee(amount);
        if (uint256(amount) + fee > uint256(jv.budget)) revert IneligibleJob();

        // 8. Hood: exposure + concentration check (reverts on violation)
        hood.checkAndRecord(jv.agent, amount);

        // 9. Deploy capital to pool (not agent wallet)
        address[] memory poolRecipients = _buildRecipients(jv.agent, recipients);
        address pool = factory.createPool(
            asset,
            jv.agent,
            jobId,
            amount,
            jv.expiry,
            poolRecipients,
            defaultPerTxLimit,
            address(hood)
        );
        vault.deploy(pool, amount);

        // 10. Record position
        positions[jobId] = Position({
            agent:            jv.agent,
            poolAddress:      pool,
            principal:        amount,
            fee:              fee,
            principalRepaid:  0,
            feeRepaid:        0,
            expiry:           jv.expiry,
            status:           Status.ACTIVE,
            tier:             cfg.tier,
            repayMode:        repayMode
        });

        emit Drawn(jobId, jv.agent, amount, fee, pool, cfg.tier, repayMode);
    }

    // ── Repayment (called by ReceivableRouter — LIEN mode) ────────────────────

    /// @notice Receives settlement funds from ReceivableRouter and distributes:
    ///   1. Sweep unspent pool capital (balance-diff, no pre-read of remainingBalance).
    ///   2. From (escrow payout + unspent): pay vault principal + fee first (shortfall
    ///      handled — vault is always made whole before agent receives anything).
    ///   3. Fee split: lpBps → vault, treasuryBps → treasury, reserveBps → reserve.
    ///   4. True surplus (escrow remainder + unspent) → agent in one transfer.
    ///   5. pool.freeze() on all paths.
    function receivePayout(uint256 jobId, uint256 amount) external nonReentrant onlyRouter {
        Position storage p = positions[jobId];
        if (p.status != Status.ACTIVE) revert NotActive();

        // ── Step 1: Sweep unspent pool capital (balance-diff) ─────────────────
        AverisJobPool pool = AverisJobPool(p.poolAddress);
        uint256 balBefore = asset.balanceOf(address(this));
        pool.returnUnspent(address(this));
        uint256 unspent = asset.balanceOf(address(this)) - balBefore;

        // ── Step 2: Total available = escrow payout + unspent ─────────────────
        uint256 totalAvailable = amount + unspent;
        uint256 totalDue       = uint256(p.principal - p.principalRepaid)
                               + uint256(p.fee       - p.feeRepaid);

        uint256 toProtocol = totalAvailable < totalDue ? totalAvailable : totalDue;
        uint256 toAgent    = totalAvailable - toProtocol;

        // ── Step 3: Split protocol share into principal + fee ─────────────────
        uint256 principalDue  = p.principal - p.principalRepaid;
        uint256 principalPaid = toProtocol < principalDue ? toProtocol : principalDue;
        uint256 feePaid       = toProtocol - principalPaid;

        p.principalRepaid += uint128(principalPaid);
        p.feeRepaid       += uint128(feePaid);

        // ── Step 4: Distribute to vault / treasury / reserve ──────────────────
        if (principalPaid > 0 || feePaid > 0) {
            (uint256 lpFee, uint256 tFee, uint256 rFee) = _splitFee(feePaid);

            uint256 toVault = principalPaid + lpFee;
            if (toVault > 0) {
                asset.approve(address(vault), toVault);
                vault.receiveRepayment(principalPaid, lpFee);
            }
            if (tFee > 0) asset.safeTransfer(treasury, tFee);
            if (rFee > 0) {
                asset.approve(address(reserveFund), rFee);
                reserveFund.receiveReserveFee(rFee);
            }

            emit Repaid(jobId, principalPaid, feePaid);
            emit FeeDistributed(jobId, lpFee, tFee, rFee);
        }

        // ── Step 5: Single transfer of escrow surplus + unspent to agent ──────
        if (toAgent > 0) asset.safeTransfer(p.agent, toAgent);

        // ── Step 6: Freeze pool (always) ──────────────────────────────────────
        pool.freeze();

        if (p.principalRepaid == p.principal && p.feeRepaid == p.fee) {
            p.status = Status.REPAID;
            hood.releaseExposure(p.agent, p.principal);
        }
        // Partial recovery: finalizeDefault() handles residual cleanup.
    }

    // ── OBLIGATION mode repayment ─────────────────────────────────────────────

    /// @notice Agent repays principal + fee directly for OBLIGATION-mode positions.
    ///         Sweeps unspent pool capital (balance-diff) and returns it to the agent.
    ///         Fee is split 70/20/10 across vault (LP yield) / treasury / reserve.
    ///         pool.freeze() is always called.
    function repayObligation(uint256 jobId) external nonReentrant {
        Position storage p = positions[jobId];
        if (p.status != Status.ACTIVE) revert NotActive();
        if (p.repayMode != IJobAdapter.RepayMode.OBLIGATION) revert Unauthorized();
        if (msg.sender != p.agent) revert Unauthorized();

        uint128 principalDue = p.principal - p.principalRepaid;
        uint128 feeDue       = p.fee       - p.feeRepaid;
        uint256 totalDue     = uint256(principalDue) + uint256(feeDue);

        // Pull repayment from agent
        asset.safeTransferFrom(msg.sender, address(this), totalDue);

        // ── Sweep unspent pool capital (balance-diff) ─────────────────────────
        AverisJobPool pool = AverisJobPool(p.poolAddress);
        uint256 balBefore = asset.balanceOf(address(this));
        pool.returnUnspent(address(this));
        uint256 unspent = asset.balanceOf(address(this)) - balBefore;

        // ── Distribute: principal + fee to vault/treasury/reserve ─────────────
        (uint256 lpFee, uint256 tFee, uint256 rFee) = _splitFee(feeDue);

        uint256 toVault = uint256(principalDue) + lpFee;
        asset.approve(address(vault), toVault);
        vault.receiveRepayment(principalDue, lpFee);

        if (tFee > 0) asset.safeTransfer(treasury, tFee);
        if (rFee > 0) {
            asset.approve(address(reserveFund), rFee);
            reserveFund.receiveReserveFee(rFee);
        }

        // ── Return unspent pool capital to agent ──────────────────────────────
        if (unspent > 0) asset.safeTransfer(p.agent, unspent);

        // ── Freeze pool (always) ──────────────────────────────────────────────
        pool.freeze();

        p.principalRepaid = p.principal;
        p.feeRepaid       = p.fee;
        p.status          = Status.REPAID;
        hood.releaseExposure(p.agent, p.principal);
        emit Repaid(jobId, p.principal, p.fee);
        emit FeeDistributed(jobId, lpFee, tFee, rFee);
    }

    // ── Default finalization ──────────────────────────────────────────────────

    /// @notice Permissionlessly finalize a defaulted/expired/rejected position.
    /// Recovers unspent pool capital before writing off net loss.
    function finalizeDefault(uint256 jobId) external {
        Position storage p = positions[jobId];
        if (p.status != Status.ACTIVE) revert NotActive();

        // Recover unspent pool capital first
        AverisJobPool pool = AverisJobPool(p.poolAddress);
        pool.returnUnspent(address(vault));
        pool.freeze();

        // Net loss = principal drawn - principal repaid - unspent returned
        // vault.deploy() increased outstandingPrincipal by p.principal;
        // vault.deploy(pool) means pool held the capital.
        // returnUnspent transferred remaining balance back to vault.
        // So net loss = p.principal - p.principalRepaid - pool's returned amount.
        // We can't know exactly how much was returned here without a return value,
        // so we write off what the vault still thinks is outstanding for this position:
        // outstanding = principal - principalRepaid (vault doesn't know about pool residual yet).
        // The returnUnspent call already transferred funds back — vault.availableLiquidity()
        // increased but outstandingPrincipal hasn't been adjusted yet.
        // We write off only the net loss: principal - principalRepaid - residualReturned.
        // We use the pool's accounting to get this right.
        // The gross outstanding debt (before recovery) is principal - principalRepaid.
        // returnUnspent() already transferred the unspent cash back to the vault.
        // We write off the full gross outstanding: vault clears the principal debt,
        // and the cash that came back increases vault.availableLiquidity().
        // Net effect on totalAssets: outstandingPrincipal -= debt; balance += unspent.
        // This correctly reflects that only the actually-spent amount is a real loss.
        uint256 netPrincipalLoss = uint256(p.principal) > uint256(p.principalRepaid)
            ? uint256(p.principal) - uint256(p.principalRepaid)
            : 0;

        // Determine final status
        Status finalStatus = p.expiry < block.timestamp ? Status.EXPIRED : Status.DEFAULTED;
        if (p.principalRepaid > 0) finalStatus = Status.PARTIALLY_RECOVERED;

        if (netPrincipalLoss > 0) vault.writeOff(netPrincipalLoss);

        p.status = finalStatus;
        hood.releaseExposure(p.agent, p.principal);
        emit Defaulted(jobId, finalStatus, netPrincipalLoss);
    }

    // ── Pool management ───────────────────────────────────────────────────────

    /// @notice Add an approved spending recipient to an active pool.
    /// Only the agent for that position can request this.
    function addPoolRecipient(uint256 jobId, address recipient) external {
        Position storage p = positions[jobId];
        if (msg.sender != p.agent) revert Unauthorized();
        if (p.status != Status.ACTIVE) revert NotActive();
        AverisJobPool(p.poolAddress).addAllowedRecipient(recipient);
        emit PoolRecipientAdded(jobId, recipient);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getPool(uint256 jobId) external view returns (address) {
        return positions[jobId].poolAddress;
    }

    function getPosition(uint256 jobId) external view returns (Position memory) {
        return positions[jobId];
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _ceilFee(uint128 amount) internal view returns (uint128) {
        return uint128((uint256(amount) * feeBps + 9_999) / 10_000);
    }

    /// @dev Splits a fee amount into (lpFee, treasuryFee, reserveFee).
    ///      Uses truncating division; any rounding dust goes to LP (vault) by default.
    function _splitFee(uint256 fee) internal view returns (uint256 lpFee, uint256 tFee, uint256 rFee) {
        if (fee == 0) return (0, 0, 0);
        tFee  = fee * feeSplit.treasuryBps / 10_000;
        rFee  = fee * feeSplit.reserveBps  / 10_000;
        lpFee = fee - tFee - rFee; // dust goes to LP
    }

    function _buildRecipients(address agent, address[] calldata extra)
        internal pure returns (address[] memory out)
    {
        out = new address[](1 + extra.length);
        out[0] = agent;
        for (uint256 i = 0; i < extra.length; i++) {
            out[i + 1] = extra[i];
        }
    }

    function _verifyObligation(
        address agent,
        address protocol,
        uint256 jobId,
        uint128 principal,
        uint128 fee,
        uint64  expiry,
        bytes calldata sig
    ) internal {
        if (sig.length != 65) revert InvalidSignature();
        if (expiry <= block.timestamp) revert ObligationExpired();

        uint256 nonce = obligationNonce[agent];
        bytes32 structHash = keccak256(abi.encode(
            OBLIGATION_TYPEHASH,
            agent,
            protocol,
            jobId,
            principal,
            fee,
            expiry,
            nonce,
            block.chainid
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != agent) revert InvalidSignature();

        // Increment nonce AFTER verification (prevent replay for same position)
        obligationNonce[agent] = nonce + 1;
    }
}
