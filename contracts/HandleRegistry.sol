// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MezoChat handle registry
/// @notice Maps lowercase @handles to wallet addresses on Mezo so anyone can verify who a handle pays.
/// Users can claim directly, or the MezoChat relayer claims for a wallet whose ownership it verified by signature.
/// Nobody (including the relayer) can take a handle that already belongs to someone else.
contract HandleRegistry {
    address public immutable relayer;
    mapping(bytes32 => address) private _owner;   // keccak256(handle) => owner
    mapping(address => string) public handleOf;   // owner => handle

    event HandleClaimed(string handle, address indexed owner);
    event HandleReleased(string handle, address indexed owner);

    constructor(address relayer_) { relayer = relayer_; }

    function claim(string calldata handle) external { _claim(handle, msg.sender); }

    function claimFor(string calldata handle, address owner) external {
        require(msg.sender == relayer, "not relayer");
        _claim(handle, owner);
    }

    function release() external {
        string memory h = handleOf[msg.sender];
        require(bytes(h).length > 0, "no handle");
        delete _owner[keccak256(bytes(h))];
        delete handleOf[msg.sender];
        emit HandleReleased(h, msg.sender);
    }

    function resolve(string calldata handle) external view returns (address) {
        return _owner[keccak256(bytes(handle))];
    }

    function _claim(string calldata handle, address owner) internal {
        require(owner != address(0), "zero owner");
        require(isValid(handle), "bad handle");
        bytes32 k = keccak256(bytes(handle));
        address current = _owner[k];
        require(current == address(0) || current == owner, "taken");
        if (current == owner) return;
        string memory prev = handleOf[owner];
        if (bytes(prev).length > 0) {
            delete _owner[keccak256(bytes(prev))];
            emit HandleReleased(prev, owner);
        }
        _owner[k] = owner;
        handleOf[owner] = handle;
        emit HandleClaimed(handle, owner);
    }

    /// 3-32 chars, starts with a-z, then a-z 0-9 _
    function isValid(string calldata handle) public pure returns (bool) {
        bytes calldata b = bytes(handle);
        if (b.length < 3 || b.length > 32) return false;
        if (b[0] < 0x61 || b[0] > 0x7a) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) return false;
        }
        return true;
    }
}
