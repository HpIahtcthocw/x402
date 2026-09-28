// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentPayments
 * @notice On-chain settlement pool for AI-agent micropayments made via the
 *         x402 protocol (V2 "exact" scheme, EVM network).
 *
 *         A resource server that monetizes an API with x402 collects into
 *         this pool. Two settlement assets are supported:
 *           - native AVAX (asset address 0x0) — agents pay by value transfer
 *           - an EIP-3009 ERC-20 (e.g. AgentToken) — agents sign a gasless
 *             transferWithAuthorization; the facilitator broadcasts it
 *
 *         Every payment is recorded against a stable `paymentId` (derived
 *         from the HTTP request the agent paid for), so the pool doubles as
 *         an immutable, queryable audit trail: which agent paid how much, for
 *         which resource, when, and whether it was refunded.
 *
 *         The pool owner can withdraw collected value and refund payments
 *         (e.g. when the served resource turns out to be defective).
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

contract AgentPayments {
    struct Settlement {
        bytes32 paymentId;
        address payer;      // agent wallet that paid
        address token;      // address(0) = native AVAX
        uint256 amount;     // atomic units of `token`
        uint64 timestamp;   // when the payment was recorded
        bool refunded;
    }

    address public immutable owner;

    // paymentId => settlement record (one settlement per paymentId)
    mapping(bytes32 => Settlement) public settlements;
    // paymentId => exists flag (settlements[].payer == 0x0 also implies absent)
    // Track collected balances per token so withdrawals are provably covered.
    mapping(address => uint256) public collected;   // token => native / ERC-20 held

    event PaymentRecorded(
        bytes32 indexed paymentId,
        address indexed payer,
        address token,
        uint256 amount,
        uint64 timestamp
    );
    event PaymentRefunded(bytes32 indexed paymentId, uint256 amount);
    event Withdrawn(address token, uint256 amount, address to);

    error NotOwner();
    error PaymentAlreadyRecorded(bytes32 paymentId);
    error PaymentNotFound(bytes32 paymentId);
    error AlreadyRefunded(bytes32 paymentId);
    error NothingToWithdraw(address token);
    error NativeTransferFailed();
    error ERC20TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    // ------------------------------------------------------------------ record

    /**
     * @notice Record a native-AVAX micropayment. The paying agent sends
     *         `msg.value` alongside this call; `paymentId` must be fresh.
     */
    function recordNative(bytes32 paymentId, address payer) external payable {
        if (settlements[paymentId].payer != address(0)) {
            revert PaymentAlreadyRecorded(paymentId);
        }
        if (msg.value == 0) revert NothingToWithdraw(address(0)); // reuse: zero payment

        settlements[paymentId] = Settlement({
            paymentId: paymentId,
            payer: payer,
            token: address(0),
            amount: msg.value,
            timestamp: uint64(block.timestamp),
            refunded: false
        });
        collected[address(0)] += msg.value;

        emit PaymentRecorded(paymentId, payer, address(0), msg.value, uint64(block.timestamp));
    }

    /**
     * @notice Record an ERC-20 micropayment. The token must already be in the
     *         pool (facilitator called transferWithAuthorization / transferFrom
     *         beforehand); this function books it against `paymentId`.
     */
    function recordERC20(
        bytes32 paymentId,
        address payer,
        address token,
        uint256 amount
    ) external {
        if (settlements[paymentId].payer != address(0)) {
            revert PaymentAlreadyRecorded(paymentId);
        }
        if (amount == 0) revert NothingToWithdraw(token);

        settlements[paymentId] = Settlement({
            paymentId: paymentId,
            payer: payer,
            token: token,
            amount: amount,
            timestamp: uint64(block.timestamp),
            refunded: false
        });
        collected[token] += amount;

        emit PaymentRecorded(paymentId, payer, token, amount, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------ refund

    /**
     * @notice Refund a recorded payment back to the original payer.
     *         Owner-only: refunds are a business decision of the resource
     *         operator. Native refunds are sent as AVAX; ERC-20 refunds call
     *         token.transfer.
     */
    function refund(bytes32 paymentId) external onlyOwner {
        Settlement storage s = settlements[paymentId];
        if (s.payer == address(0)) revert PaymentNotFound(paymentId);
        if (s.refunded) revert AlreadyRefunded(paymentId);

        s.refunded = true;
        collected[s.token] -= s.amount;

        if (s.token == address(0)) {
            (bool ok, ) = payable(s.payer).call{ value: s.amount }("");
            if (!ok) revert NativeTransferFailed();
        } else {
            bool ok = IERC20(s.token).transfer(s.payer, s.amount);
            if (!ok) revert ERC20TransferFailed();
        }

        emit PaymentRefunded(paymentId, s.amount);
    }

    // ------------------------------------------------------------------ withdraw

    /**
     * @notice Withdraw collected value (native AVAX when token == 0x0, else
     *         ERC-20) to a destination address.
     */
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        uint256 bal = collected[token];
        if (bal == 0) revert NothingToWithdraw(token);
        uint256 w = amount > bal ? bal : amount;

        collected[token] = bal - w;

        if (token == address(0)) {
            (bool ok, ) = payable(to).call{ value: w }("");
            if (!ok) revert NativeTransferFailed();
        } else {
            bool ok = IERC20(token).transfer(to, w);
            if (!ok) revert ERC20TransferFailed();
        }

        emit Withdrawn(token, w, to);
    }

    // ------------------------------------------------------------------ views

    function isRecorded(bytes32 paymentId) external view returns (bool) {
        return settlements[paymentId].payer != address(0);
    }

    function nativeHeld() external view returns (uint256) {
        return collected[address(0)];
    }
}
