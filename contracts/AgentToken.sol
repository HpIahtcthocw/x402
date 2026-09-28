// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentToken
 * @notice ERC-20 with EIP-3009 (Transfer with Authorization) — the token
 *         settlement primitive behind the x402 "exact" scheme on EVM.
 *
 *         x402 V2 defines the "exact" scheme as an EIP-3009
 *         `transferWithAuthorization`: the paying agent signs an off-chain
 *         authorization (gasless for the agent), and the resource server /
 *         facilitator broadcasts the transfer. This keeps agent micropayments
 *         cheap: the agent never needs native gas to pay.
 *
 *         Minting is owner-only and exists purely for demo/testnet purposes
 *         (this token is a stand-in for a stablecoin settlement asset).
 */
contract AgentToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;

    // --- EIP-3009 authorization state ---
    // Computed at compile time from the EIP-712 type strings so the domain
    // separator and struct hash always match what off-chain signers produce.
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public DOMAIN_SEPARATOR;
    // nonce => true if already used (prevents replay)
    mapping(bytes32 => bool) public authorizationState;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event Mint(address indexed to, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentToken: not owner");
        _;
    }

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    // ---------------------------------------------------------------- ERC-20

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "AgentToken: allowance exceeded");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    // ---------------------------------------------------------------- EIP-3009

    /**
     * @notice Execute a transfer authorized by `from` via EIP-712 signature.
     *         Anyone may broadcast this (typically the facilitator); `from`
     *         pays no gas.
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter, "AgentToken: authorization not yet valid");
        require(block.timestamp < validBefore, "AgentToken: authorization expired");
        require(!authorizationState[nonce], "AgentToken: authorization already used");

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == from, "AgentToken: invalid signature");

        authorizationState[nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }

    // ---------------------------------------------------------------- mint

    function mint(address to, uint256 value) external onlyOwner {
        totalSupply += value;
        balanceOf[to] += value;
        emit Mint(to, value);
        emit Transfer(address(0), to, value);
    }

    // ---------------------------------------------------------------- internal

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "AgentToken: transfer to zero address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "AgentToken: insufficient balance");
        balanceOf[from] = bal - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
